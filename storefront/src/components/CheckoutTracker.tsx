"use client"

import { useEffect, useRef } from "react"
import { generateEventId, sendCAPIViaRoute } from "@lib/pixel"

// Fires AddToCart + InitiateCheckout when customer lands on checkout page.
// AddToCart: single source of truth (bundle-selector no longer fires it).
// InitiateCheckout: signals funnel entry for Meta optimisation.
// Both dual-fire: browser fbq + CAPI via /api/capi with same eventID (FB dedups).
export default function CheckoutTracker({
  contentIds,
  value,
  currency,
  numItems,
  productPixelId,
  productCapiToken,
}: {
  contentIds: string[]
  value: number
  currency: string
  numItems: number
  productPixelId?: string
  productCapiToken?: string
}) {
  const fired = useRef(false)

  useEffect(() => {
    if (typeof window === "undefined" || fired.current) return

    const fire = () => {
      if (fired.current) return
      fired.current = true

      // Init product pixel — needed on hard load of /checkout where only
      // the store pixel was inited by FacebookPixel in layout
      if (productPixelId) {
        window.fbq?.("init", productPixelId)
      }

      const customData = {
        content_ids: contentIds,
        content_type: "product",
        value,
        currency,
        num_items: numItems,
      }

      // Reuse the eventID bundle-selector stored so Meta deduplicates the two ATC signals.
      // Fall back to a new ID if user navigated directly to /checkout.
      const atcId = sessionStorage.getItem("atc_event_id") || generateEventId()
      sessionStorage.removeItem("atc_event_id")
      const icId = generateEventId()

      // Browser — goes to every inited pixel (store + product)
      window.fbq?.("track", "AddToCart", customData, { eventID: atcId })
      window.fbq?.("track", "InitiateCheckout", customData, { eventID: icId })

      // CAPI — store pixel
      sendCAPIViaRoute({ eventName: "AddToCart", eventId: atcId, eventSourceUrl: window.location.href, customData })
      sendCAPIViaRoute({ eventName: "InitiateCheckout", eventId: icId, eventSourceUrl: window.location.href, customData })

      // CAPI — product's own pixel
      if (productPixelId && productCapiToken) {
        sendCAPIViaRoute({ eventName: "AddToCart", eventId: atcId, eventSourceUrl: window.location.href, pixelId: productPixelId, capiToken: productCapiToken, customData })
        sendCAPIViaRoute({ eventName: "InitiateCheckout", eventId: icId, eventSourceUrl: window.location.href, pixelId: productPixelId, capiToken: productCapiToken, customData })
      }
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
