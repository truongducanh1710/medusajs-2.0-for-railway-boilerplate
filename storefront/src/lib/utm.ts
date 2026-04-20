const UTM_COOKIE = "pvw_utm"
const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]

export type UtmData = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
}

export function saveUtmToCookie(searchParams: URLSearchParams) {
  const data: UtmData = {}
  let hasUtm = false

  for (const key of UTM_PARAMS) {
    const val = searchParams.get(key)
    if (val) {
      ;(data as any)[key] = val
      hasUtm = true
    }
  }

  if (!hasUtm) return

  const expires = new Date()
  expires.setDate(expires.getDate() + 7)
  document.cookie = `${UTM_COOKIE}=${encodeURIComponent(JSON.stringify(data))}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`
}

export function getUtmFromCookie(): UtmData {
  if (typeof document === "undefined") return {}

  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${UTM_COOKIE}=`))

  if (!match) return {}

  try {
    return JSON.parse(decodeURIComponent(match.split("=").slice(1).join("=")))
  } catch {
    return {}
  }
}
