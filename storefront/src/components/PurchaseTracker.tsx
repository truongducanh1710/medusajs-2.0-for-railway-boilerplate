"use client"

import { useEffect } from "react"
import { generateEventId, sendCAPIViaRoute } from "@lib/pixel"
import { getUtmFromCookie } from "@lib/utm"

export default function PurchaseTracker({
  orderId,
  value,
  currency,
  contentIds,
}: {
  orderId: string
  value: number
  currency: string
  contentIds: string[]
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

    // CAPI via server route (token stays server-side)
    sendCAPIViaRoute({
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
  }, [orderId])

  return null
}
