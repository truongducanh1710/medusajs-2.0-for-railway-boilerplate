"use client"

import { useEffect, useRef } from "react"
import { generateEventId, sendCAPIViaRoute } from "@lib/pixel"

// Fires AddToCart when customer lands on checkout page.
// (Order flow skips the cart — product page goes straight to checkout,
// so checkout entry is the AddToCart signal.)
// Dual-fire: browser fbq + CAPI via /api/capi with same eventID (FB dedups).
// Also fires to the product's own pixel when it has one (quick-buy flow
// means the cart holds a single product).
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

      const eventId = generateEventId()
      const customData = {
        content_ids: contentIds,
        content_type: "product",
        value,
        currency,
        num_items: numItems,
      }

      // Browser — goes to every inited pixel (store + product)
      window.fbq?.("track", "AddToCart", customData, { eventID: eventId })

      // CAPI — store pixel (token resolved server-side from store metadata)
      sendCAPIViaRoute({
        eventName: "AddToCart",
        eventId,
        eventSourceUrl: window.location.href,
        customData,
      })

      // CAPI — product's own pixel (only when it has its own token)
      if (productPixelId && productCapiToken) {
        sendCAPIViaRoute({
          eventName: "AddToCart",
          eventId,
          eventSourceUrl: window.location.href,
          pixelId: productPixelId,
          capiToken: productCapiToken,
          customData,
        })
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
