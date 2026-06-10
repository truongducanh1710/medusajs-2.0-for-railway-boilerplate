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

export function saveUtmToCookie(searchParams: URLSearchParams) {
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

  const expires = new Date()
  expires.setDate(expires.getDate() + 7)
  document.cookie = `${UTM_COOKIE}=${encodeURIComponent(JSON.stringify(data))}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`
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
