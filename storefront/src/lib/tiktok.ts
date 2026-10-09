// TikTok Pixel helper. The ttq stub queues calls until events.js loads, so
// trackers can call ttqTrack() at any time without waiting for a ready signal.

declare global {
  interface Window {
    ttq?: any
    TiktokAnalyticsObject?: string
  }
}

export const TIKTOK_PIXEL_ID =
  process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID || "DB4AM9JC77U04C8M8F40"

let loaded = false

// Official TikTok base snippet, minus the auto page() call (TikTokPixel handles that)
export function loadTikTokPixel(pixelId: string = TIKTOK_PIXEL_ID) {
  if (typeof window === "undefined" || !pixelId || loaded) return
  loaded = true

  const w = window as any
  const t = "ttq"
  w.TiktokAnalyticsObject = t
  const ttq = (w[t] = w[t] || [])
  ttq.methods = [
    "page", "track", "identify", "instances", "debug", "on", "off", "once", "ready",
    "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent",
  ]
  ttq.setAndDefer = function (obj: any, method: string) {
    obj[method] = function () {
      obj.push([method].concat(Array.prototype.slice.call(arguments, 0)))
    }
  }
  for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i])
  ttq.instance = function (id: string) {
    const e = ttq._i[id] || []
    for (let n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n])
    return e
  }
  ttq.load = function (id: string, opts?: any) {
    const src = "https://analytics.tiktok.com/i18n/pixel/events.js"
    ttq._i = ttq._i || {}
    ttq._i[id] = []
    ttq._i[id]._u = src
    ttq._t = ttq._t || {}
    ttq._t[id] = +new Date()
    ttq._o = ttq._o || {}
    ttq._o[id] = opts || {}
    const s = document.createElement("script")
    s.type = "text/javascript"
    s.async = true
    s.src = src + "?sdkid=" + id + "&lib=" + t
    document.head.appendChild(s)
  }

  ttq.load(pixelId)
}

export function ttqPage() {
  if (typeof window === "undefined") return
  loadTikTokPixel()
  window.ttq?.page()
}

// Standard events: ViewContent, AddToCart, InitiateCheckout, PlaceAnOrder, CompletePayment
export function ttqTrack(event: string, data: Record<string, unknown> = {}, eventId?: string) {
  if (typeof window === "undefined") return
  loadTikTokPixel()
  try {
    window.ttq?.track(event, data, eventId ? { event_id: eventId } : undefined)
  } catch {}
}
