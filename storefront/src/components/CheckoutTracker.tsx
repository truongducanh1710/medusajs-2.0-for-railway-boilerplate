"use client"

import { useEffect, useRef } from "react"
import { generateEventId, sendCAPIViaRoute } from "@lib/pixel"

// Fires AddToCart when customer lands on checkout page.
// Dual-fire: browser fbq + CAPI via /api/capi with same eventID (FB dedups).
export default function CheckoutTracker({
  contentIds,
  value,
  currency,
  numItems,
}: {
  contentIds: string[]
  value: number
  currency: string
  numItems: number
}) {
  const fired = useRef(false)

  useEffect(() => {
    if (typeof window === "undefined" || fired.current) return

    const fire = () => {
      if (fired.current) return
      fired.current = true

      const eventId = generateEventId()
      const customData = {
        content_ids: contentIds,
        content_type: "product",
        value,
        currency,
        num_items: numItems,
      }

      window.fbq?.("track", "AddToCart", customData, { eventID: eventId })

      sendCAPIViaRoute({
        eventName: "AddToCart",
        eventId,
        eventSourceUrl: window.location.href,
        customData,
      })
    }

    // Wait for fbq to be ready (FB script may not be loaded yet)
    if (window.fbq) {
      fire()
    } else {
      const timer = setTimeout(fire, 1500)
      return () => clearTimeout(timer)
    }
  }, [])

  return null
}
