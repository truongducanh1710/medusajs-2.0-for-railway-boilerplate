const UTM_COOKIE = "pvw_utm"
const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"]

export type UtmData = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  utm_id?: string
  fbclid?: string
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

  if (!hasData && !data.fbp && !data.fbc) return

  // URL có UTM mới → bộ UTM mới thay hẳn bộ cũ (lượt click quảng cáo mới nhất).
  // URL không có UTM → giữ nguyên UTM cũ, chỉ cập nhật fbp/fbc.
  const merged: UtmData = hasData
    ? { ...data, fbp: data.fbp ?? cu.fbp, fbc: data.fbc ?? cu.fbc }
    : { ...cu, ...(data.fbp ? { fbp: data.fbp } : {}), ...(data.fbc ? { fbc: data.fbc } : {}) }

  const domain = cookieDomain()
  // Khách cũ còn cookie gắn riêng host (trước khi có domain) — đã gộp vào `cu`
  // ở trên, xoá đi để không tồn tại 2 cookie trùng tên.
  if (domain) document.cookie = `${UTM_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`

  const expires = new Date()
  expires.setDate(expires.getDate() + 7)
  document.cookie = `${UTM_COOKIE}=${encodeURIComponent(JSON.stringify(merged))}; expires=${expires.toUTCString()}; path=/; SameSite=Lax${domain}`
}

export function getUtmFromCookie(): UtmData {
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
