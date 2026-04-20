"use client"

import { useEffect } from "react"
import { generateEventId, sendCAPIEvent } from "@lib/pixel"
import { getUtmFromCookie } from "@lib/utm"

export default function PurchaseTracker({
  orderId,
  value,
  currency,
  contentIds,
  pixelId,
  capiToken,
}: {
  orderId: string
  value: number
  currency: string
  contentIds: string[]
  pixelId?: string
  capiToken?: string
}) {
  useEffect(() => {
    if (typeof window === "undefined") return

    const eventId = generateEventId()
    const utm = getUtmFromCookie()

    if (window.fbq) {
      window.fbq(
        "track",
        "Purchase",
        {
          content_ids: contentIds,
          content_type: "product",
          value,
          currency,
          order_id: orderId,
        },
        { eventID: eventId }
      )
    }

    // Server-side CAPI via global pixel
    const globalPixelId = process.env.NEXT_PUBLIC_FB_PIXEL_ID
    if (globalPixelId && capiToken) {
      sendCAPIEvent({
        pixelId: globalPixelId,
        accessToken: capiToken,
        eventName: "Purchase",
        eventId,
        eventSourceUrl: window.location.href,
        customData: {
          value,
          currency,
          order_id: orderId,
          content_ids: contentIds,
          content_type: "product",
          ...utm,
        },
      })
    }

    // Per-product pixel CAPI
    if (pixelId && pixelId !== globalPixelId && capiToken) {
      sendCAPIEvent({
        pixelId,
        accessToken: capiToken,
        eventName: "Purchase",
        eventId,
        eventSourceUrl: window.location.href,
        customData: { value, currency, order_id: orderId, content_ids: contentIds, ...utm },
      })
    }
  }, [orderId])

  return null
}
