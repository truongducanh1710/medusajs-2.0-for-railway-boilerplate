"use client"

import { useEffect } from "react"
import { generateEventId, sendCAPIViaRoute } from "@lib/pixel"
import { getUtmFromCookie } from "@lib/utm"

export default function PurchaseTracker({
  orderId,
  value,
  currency,
  contentIds,
  productPixelId,
  productCapiToken,
}: {
  orderId: string
  value: number
  currency: string
  contentIds: string[]
  productPixelId?: string
  productCapiToken?: string
}) {
  useEffect(() => {
    if (typeof window === "undefined") return

    const eventId = generateEventId()
    const utm = getUtmFromCookie()

    const customData = {
      value,
      currency,
      order_id: orderId,
      content_ids: contentIds,
      content_type: "product",
      ...utm,
    }

    // Dùng CompleteRegistration thay vì Purchase — đơn COD chưa chắc giao được
    // Purchase thật sẽ được bắn từ backend khi Pancake báo status=3 (giao thành công)
    if (window.fbq) {
      window.fbq("track", "CompleteRegistration", customData, { eventID: eventId })
    }

    // CAPI → pixel chung (global)
    sendCAPIViaRoute({
      eventName: "CompleteRegistration",
      eventId,
      eventSourceUrl: window.location.href,
      customData,
    })

    // CAPI → pixel riêng sản phẩm (nếu có và khác pixel chung)
    if (productPixelId && productCapiToken) {
      sendCAPIViaRoute({
        eventName: "CompleteRegistration",
        eventId,
        eventSourceUrl: window.location.href,
        pixelId: productPixelId,
        capiToken: productCapiToken,
        customData,
      })
    }
  }, [orderId])

  return null
}
