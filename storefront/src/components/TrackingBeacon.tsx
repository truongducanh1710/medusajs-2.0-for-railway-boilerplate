"use client"

import { useEffect, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { getUtmFromCookie, saveUtmToCookie } from "@lib/utm"

const VISITOR_COOKIE = "pvw_vid"
const SESSION_COOKIE = "pvw_sid"
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 phút

function getCookie(name: string): string {
  if (typeof document === "undefined") return ""
  const match = document.cookie.split("; ").find((r) => r.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : ""
}

function setCookie(name: string, value: string, maxAgeSec: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSec}; path=/; SameSite=Lax`
}

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function getOrCreateVisitorId(): string {
  let vid = getCookie(VISITOR_COOKIE)
  if (!vid) {
    vid = uuid()
    setCookie(VISITOR_COOKIE, vid, 365 * 24 * 3600)
  }
  return vid
}

function getOrCreateSessionId(): string {
  let sid = getCookie(SESSION_COOKIE)
  if (!sid) {
    sid = uuid()
  }
  // Refresh session TTL mỗi pageview
  setCookie(SESSION_COOKIE, sid, SESSION_TTL_MS / 1000)
  return sid
}

export default function TrackingBeacon() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const pageEnterTime = useRef<number>(Date.now())
  const prevUrl = useRef<string>("")

  useEffect(() => {
    // Save UTM params nếu có trong URL
    saveUtmToCookie(searchParams)

    const visitorId = getOrCreateVisitorId()
    const sessionId = getOrCreateSessionId()
    const utm = getUtmFromCookie()
    const url = window.location.href
    const timeOnPrev = prevUrl.current ? Math.round((Date.now() - pageEnterTime.current) / 1000) : 0

    const cartId = getCookie("_medusa_cart_id") || getCookie("cartid") || undefined
    const hasCart = Boolean(cartId)

    const payload = JSON.stringify({
      visitor_id: visitorId,
      session_id: sessionId,
      url,
      title: document.title,
      referrer: document.referrer,
      utm_source: utm.utm_source ?? "",
      utm_medium: utm.utm_medium ?? "",
      utm_campaign: utm.utm_campaign ?? "",
      utm_content: utm.utm_content ?? "",
      utm_term: utm.utm_term ?? "",
      time_on_prev_page: timeOnPrev,
      has_cart: hasCart,
      cart_id: cartId,
    })

    const apiBase = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "https://api.phanviet.vn"
    const pubKey = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY || ""

    // sendBeacon fire-and-forget; không block navigation
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" })
      // sendBeacon không hỗ trợ custom header → dùng fetch async thay thế
      fetch(`${apiBase}/store/track/pageview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-publishable-api-key": pubKey,
        },
        body: payload,
        keepalive: true, // fire-and-forget, không block navigation
      }).catch(() => {})
    }

    prevUrl.current = url
    pageEnterTime.current = Date.now()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  return null
}
