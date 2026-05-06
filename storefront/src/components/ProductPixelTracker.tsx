"use client"

import { useEffect, useRef } from "react"
import { generateEventId, sendCAPIViaRoute } from "@lib/pixel"

const SCROLL_MILESTONES = [25, 50, 75, 100]
const TIME_MILESTONES = [10, 30, 60, 90, 120, 180, 300] // seconds

function fireCustomEvent(name: string) {
  if (typeof window === "undefined" || !window.fbq) return
  window.fbq("trackCustom", name, {}, { eventID: generateEventId() })
}

export default function ProductPixelTracker({
  pixelIds,
  productId,
  productTitle,
  price,
  currency,
  productPixelId,
  productCapiToken,
}: {
  pixelIds: string[]
  productId: string
  productTitle: string
  price: number
  currency: string
  productPixelId?: string
  productCapiToken?: string
}) {
  const scrollFired = useRef(new Set<number>())
  const timeFired = useRef(new Set<number>())
  const startTime = useRef(Date.now())

  // ViewContent + init per-product pixels
  useEffect(() => {
    if (typeof window === "undefined" || !window.fbq) return

    // Only init per-product pixels not already inited by global FacebookPixel
    const globalId = process.env.NEXT_PUBLIC_FB_PIXEL_ID || ""
    for (const id of pixelIds) {
      if (id && id !== globalId) {
        window.fbq("init", id)
      }
    }

    const eventId = generateEventId()
    window.fbq(
      "track",
      "ViewContent",
      {
        content_ids: [productId],
        content_name: productTitle,
        content_type: "product",
        value: price / 100,
        currency,
      },
      { eventID: eventId }
    )

    // CAPI dedup — global pixel
    sendCAPIViaRoute({
      eventName: "ViewContent",
      eventId,
      eventSourceUrl: window.location.href,
      customData: {
        content_ids: [productId],
        content_name: productTitle,
        content_type: "product",
        value: price / 100,
        currency,
      },
    })

    // CAPI dedup — per-product pixel (only if different from global)
    const globalId = process.env.NEXT_PUBLIC_FB_PIXEL_ID || ""
    if (productPixelId && productCapiToken && productPixelId !== globalId) {
      sendCAPIViaRoute({
        eventName: "ViewContent",
        eventId,
        eventSourceUrl: window.location.href,
        pixelId: productPixelId,
        capiToken: productCapiToken,
        customData: {
          content_ids: [productId],
          content_name: productTitle,
          content_type: "product",
          value: price / 100,
          currency,
        },
      })
    }

    scrollFired.current.clear()
    timeFired.current.clear()
    startTime.current = Date.now()
  }, [productId])

  // Scroll depth tracking
  useEffect(() => {
    function onScroll() {
      const scrolled = window.scrollY + window.innerHeight
      const total = document.documentElement.scrollHeight
      const pct = Math.round((scrolled / total) * 100)

      for (const milestone of SCROLL_MILESTONES) {
        if (pct >= milestone && !scrollFired.current.has(milestone)) {
          scrollFired.current.add(milestone)
          fireCustomEvent(`ScrollDepth_${milestone}_percent`)
        }
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [productId])

  // Time on page tracking
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000)

      for (const milestone of TIME_MILESTONES) {
        if (elapsed >= milestone && !timeFired.current.has(milestone)) {
          timeFired.current.add(milestone)
          fireCustomEvent(`TimeOnPage_${milestone}_seconds`)
        }
      }

      // Stop checking after last milestone
      if (elapsed >= TIME_MILESTONES[TIME_MILESTONES.length - 1]) {
        clearInterval(interval)
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [productId])

  return null
}
