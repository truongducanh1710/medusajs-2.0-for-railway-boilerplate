const UTM_COOKIE = "pvw_utm"
export const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"]

// Bản sao dự phòng trong localStorage. Cookie có thể biến mất giữa lúc vào trang và
// lúc đặt hàng: đơn #79 (01/10/2026) mở trong trình duyệt của app Facebook trên iOS,
// cookie có UTM lúc 10:47:30 nhưng tới 10:53 đặt hàng thì không còn → đơn mất camp.
// Đọc cookie trước, mất thì lấy bản này.
const UTM_LOCAL_KEY = "pvw_utm"
const UTM_TTL_MS = 7 * 24 * 3600_000 // khớp hạn cookie

/** Có ít nhất một trường đủ để ghép đơn về camp. */
export function hasUtm(d: Record<string, any> | null | undefined): boolean {
  return !!(d && (d.utm_campaign || d.utm_id || d.utm_source))
}

// Dấu vết nguồn khi KHÔNG có UTM: mã click TikTok/Google + host trang giới thiệu. Đơn 93966
// (11/10/2026) không UTM, không fbclid → không biết từ TikTok, Google hay link chia sẻ.
export const SOURCE_SIGNALS = ["fbclid", "ttclid", "gclid", "ref"] as const

/** Có dấu vết nguồn (mã click hoặc trang giới thiệu) dù không có UTM. */
function hasSignal(d: Record<string, any> | null | undefined): boolean {
  return !!(d && (d.ttclid || d.gclid || d.fbclid || d.ref))
}

/** Chỉ lấy các trường UTM + mã click + ref, bỏ mọi thứ khác (vd metadata giỏ hàng). */
export function pickUtm(d: Record<string, any> | null | undefined): UtmData {
  const out: Record<string, string> = {}
  if (!d) return out
  for (const k of [...UTM_PARAMS, ...SOURCE_SIGNALS]) {
    if (d[k]) out[k] = String(d[k])
  }
  return out
}

function writeUtmLocal(data: UtmData) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return
    window.localStorage.setItem(UTM_LOCAL_KEY, JSON.stringify({ ...data, _ts: Date.now() }))
  } catch {
    // Chế độ riêng tư / bị chặn bộ nhớ — cookie vẫn là nguồn chính
  }
}

function readUtmLocal(): UtmData {
  try {
    if (typeof window === "undefined" || !window.localStorage) return {}
    const raw = window.localStorage.getItem(UTM_LOCAL_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed?._ts || Date.now() - parsed._ts > UTM_TTL_MS) return {}
    const { _ts, ...data } = parsed
    return data
  } catch {
    return {}
  }
}

export type UtmData = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  utm_id?: string
  fbclid?: string
  ttclid?: string  // TikTok click id
  gclid?: string   // Google Ads click id
  ref?: string     // host trang giới thiệu bên ngoài (vd www.google.com, zalo.me) — chỉ lưu host
  fbp?: string   // FB browser cookie _fbp
  fbc?: string   // FB click cookie _fbc (derived from fbclid)
}

// Cookie dùng chung cho www.phanviet.vn và phanviet.vn — cả hai đều phục vụ trực
// tiếp (không redirect), cookie không có domain chỉ gắn với đúng host khách vào.
function cookieDomain(): string {
  if (typeof location === "undefined") return ""
  return /(^|\.)phanviet\.vn$/.test(location.hostname) ? "; domain=.phanviet.vn" : ""
}

function readUtmCookie(): UtmData {
  if (typeof document === "undefined") return {}
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${UTM_COOKIE}=`))
  if (!match) return {}
  try {
    return JSON.parse(decodeURIComponent(match.split("=").slice(1).join("=")))
  } catch {
    return {}
  }
}

export function saveUtmToCookie(searchParams: URLSearchParams) {
  // Gộp vào cookie cũ thay vì ghi đè. Hàm này chạy MỖI LẦN chuyển trang
  // (TrackingBeacon). Trước đây trang không có UTM (vd trang thanh toán) mà đã có
  // cookie _fbp thì cookie bị ghi đè chỉ còn {fbp} → mất utm_campaign → đơn không
  // ghép được về camp. UTM chỉ bị thay khi URL mới mang UTM mới.
  const cu = readUtmCookie()
  const data: UtmData = {}
  let hasData = false

  for (const key of UTM_PARAMS) {
    const val = searchParams.get(key)
    if (val) {
      ;(data as any)[key] = val
      hasData = true
    }
  }

  // Capture fbclid từ URL
  const fbclid = searchParams.get("fbclid")
  if (fbclid) {
    data.fbclid = fbclid
    // Tạo fbc theo format FB: fb.1.{timestamp}.{fbclid}
    data.fbc = `fb.1.${Date.now()}.${fbclid}`
    hasData = true
  }

  // Mã click TikTok / Google = một lượt bấm quảng cáo mới, giống fbclid
  for (const k of ["ttclid", "gclid"] as const) {
    const v = searchParams.get(k)
    if (v) {
      data[k] = v
      hasData = true
    }
  }

  // Trang giới thiệu bên ngoài (chỉ host, không lưu đường dẫn đầy đủ) — để đoán nguồn khi không có UTM
  let externalRef: string | undefined
  if (typeof document !== "undefined" && document.referrer) {
    try {
      const host = new URL(document.referrer).hostname
      if (host && !/(^|\.)phanviet\.vn$/.test(host)) externalRef = host
    } catch {}
  }
  if (externalRef) data.ref = externalRef

  // Capture _fbp và _fbc cookie của FB pixel (nếu có)
  if (typeof document !== "undefined") {
    const fbpMatch = document.cookie.split("; ").find(r => r.startsWith("_fbp="))
    if (fbpMatch) data.fbp = fbpMatch.split("=")[1]

    // Đọc _fbc trực tiếp nếu chưa có từ fbclid trên URL
    if (!data.fbc) {
      const fbcMatch = document.cookie.split("; ").find(r => r.startsWith("_fbc="))
      if (fbcMatch) data.fbc = fbcMatch.split("=")[1]
    }
  }

  if (!hasData && !data.fbp && !data.fbc && !data.ref) return

  // URL có UTM mới → bộ UTM mới thay hẳn bộ cũ (lượt click quảng cáo mới nhất).
  // URL không có UTM → giữ nguyên UTM cũ, chỉ cập nhật fbp/fbc.
  const merged: UtmData = hasData
    ? { ...data, fbp: data.fbp ?? cu.fbp, fbc: data.fbc ?? cu.fbc }
    : { ...cu, ...(data.fbp ? { fbp: data.fbp } : {}), ...(data.fbc ? { fbc: data.fbc } : {}), ...(data.ref ? { ref: data.ref } : {}) }

  const domain = cookieDomain()
  // Khách cũ còn cookie gắn riêng host (trước khi có domain) — đã gộp vào `cu`
  // ở trên, xoá đi để không tồn tại 2 cookie trùng tên.
  if (domain) document.cookie = `${UTM_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`

  const expires = new Date()
  expires.setDate(expires.getDate() + 7)
  document.cookie = `${UTM_COOKIE}=${encodeURIComponent(JSON.stringify(merged))}; expires=${expires.toUTCString()}; path=/; SameSite=Lax${domain}`

  // Chỉ ghi đè bản dự phòng khi có UTM: lượt xem trang không có UTM không được xoá
  // mất UTM của lượt bấm quảng cáo trước đó.
  if (hasUtm(merged) || hasSignal(merged)) writeUtmLocal(merged)
}

export function getUtmFromCookie(): UtmData {
  const fromCookie = readUtmFromCookieOnly()
  if (hasUtm(fromCookie)) return fromCookie
  // Cookie mất UTM → lấy UTM từ bản dự phòng, giữ fbp/fbc mới nhất từ cookie FB
  const local = pickUtm(readUtmLocal())
  if (hasUtm(local)) return { ...fromCookie, ...local }
  // Không có UTM ở đâu cả → vẫn giữ dấu vết nguồn (mã click / ref) nếu cookie đã mất
  return { ...local, ...fromCookie }
}

function readUtmFromCookieOnly(): UtmData {
  if (typeof document === "undefined") return {}

  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${UTM_COOKIE}=`))

  // Luôn refresh fbp + fbc từ cookie FB mới nhất
  const cookies = document.cookie.split("; ")
  const fbpMatch = cookies.find(r => r.startsWith("_fbp="))
  const fbcMatch = cookies.find(r => r.startsWith("_fbc="))

  if (!match) {
    const fallback: UtmData = {}
    if (fbpMatch) fallback.fbp = fbpMatch.split("=")[1]
    if (fbcMatch) fallback.fbc = fbcMatch.split("=")[1]
    return fallback
  }

  try {
    const data = JSON.parse(decodeURIComponent(match.split("=").slice(1).join("=")))
    if (fbpMatch) data.fbp = fbpMatch.split("=")[1]
    if (fbcMatch && !data.fbc) data.fbc = fbcMatch.split("=")[1]
    return data
  } catch {
    return {}
  }
}
