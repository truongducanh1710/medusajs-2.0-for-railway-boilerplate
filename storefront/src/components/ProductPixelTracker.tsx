"use client"

import { useEffect } from "react"
import { generateEventId } from "@lib/pixel"

export default function ProductPixelTracker({
  pixelIds,
  productId,
  productTitle,
  price,
  currency,
}: {
  pixelIds: string[]
  productId: string
  productTitle: string
  price: number
  currency: string
}) {
  useEffect(() => {
    if (typeof window === "undefined" || !window.fbq) return

    const eventId = generateEventId()

    for (const pixelId of pixelIds) {
      window.fbq("init", pixelId)
    }

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
  }, [productId])

  return null
}
