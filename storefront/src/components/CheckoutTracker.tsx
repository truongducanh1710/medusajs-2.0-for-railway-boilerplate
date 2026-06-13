"use client"

import { useEffect, useRef } from "react"
import { generateEventId, sendCAPIViaRoute } from "@lib/pixel"

// Fires InitiateCheckout when customer lands on checkout page.
// AddToCart is fired earlier in bundle-selector on button click.
// Dual-fire: browser fbq + CAPI via /api/capi with same eventID (FB dedups).
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

      sessionStorage.removeItem("atc_event_id")
      const icId = generateEventId()

      // Browser — goes to every inited pixel (store + product)
      window.fbq?.("track", "InitiateCheckout", customData, { eventID: icId })

      // CAPI — store pixel
      sendCAPIViaRoute({ eventName: "InitiateCheckout", eventId: icId, eventSourceUrl: window.location.href, customData })

      // CAPI — product's own pixel
      if (productPixelId && productCapiToken) {
        sendCAPIViaRoute({ eventName: "InitiateCheckout", eventId: icId, eventSourceUrl: window.location.href, pixelId: productPixelId, capiToken: productCapiToken, customData })
      }
    }

    // Wait for FacebookPixel to init the store pixel before firing, so the
    // product pixel inited here lands after the store pixel (correct order).
    if (window.__fbqReady) {
      fire()
    } else {
      window.addEventListener("fbq:ready", fire, { once: true })
      return () => window.removeEventListener("fbq:ready", fire)
    }
  }, [])

  return null
}
