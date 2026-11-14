"use client"

import { getUtmFromCookie } from "@lib/utm"

/**
 * Landing funnel beacon → POST /store/track/event (backend table web_funnel_event).
 * Each event fires at most once per session+page+event (value-less) so counts stay per session.
 */
const sent = new Set<string>()

function cookie(name: string): string {
  if (typeof document === "undefined") return ""
  const m = document.cookie.split("; ").find((r) => r.startsWith(`${name}=`))
  return m ? decodeURIComponent(m.split("=").slice(1).join("=")) : ""
}

function sessionId(): string {
  let sid = cookie("pvw_sid")
  if (!sid) {
    try { sid = sessionStorage.getItem("pvw_fsid") || "" } catch {}
    if (!sid) {
      sid = (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)
      try { sessionStorage.setItem("pvw_fsid", sid) } catch {}
    }
  }
  return sid
}

export function productHandleFromPath(): string {
  if (typeof location === "undefined") return ""
  const m = location.pathname.match(/\/products\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : ""
}

// Last product page seen in this tab — lets the standalone /checkout page attribute its events
const HANDLE_KEY = "pvw_fhandle"

function resolveHandle(explicit?: string): string {
  const onPage = explicit || productHandleFromPath()
  try {
    if (onPage) { sessionStorage.setItem(HANDLE_KEY, onPage); return onPage }
    return sessionStorage.getItem(HANDLE_KEY) || ""
  } catch { return onPage }
}

export function trackFunnel(event: string, value?: string | number, opts: { repeat?: boolean; handle?: string } = {}) {
  try {
    if ((navigator as any).webdriver) return // automated browsers
    const handle = resolveHandle(opts.handle)
    if (!handle) return
    const key = `${handle}|${event}`
    if (!opts.repeat && sent.has(key)) return
    sent.add(key)
    const utm = getUtmFromCookie() as any
    const qs = new URLSearchParams(location.search)
    const body = JSON.stringify({
      session_id: sessionId(),
      visitor_id: cookie("pvw_vid") || undefined,
      handle,
      event,
      value: value == null ? undefined : String(value),
      utm_source: qs.get("utm_source") || utm.utm_source || undefined,
      utm_content: qs.get("utm_content") || utm.utm_content || undefined,
      campaign_id: qs.get("campaign_id") || qs.get("utm_campaign") || utm.utm_campaign || undefined,
      device: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop",
    })
    const base = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "https://api.phanviet.vn"
    fetch(`${base}/store/track/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || "" },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {}
}
