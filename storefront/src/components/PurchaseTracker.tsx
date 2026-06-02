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
  paymentMethod = "cod",
}: {
  orderId: string
  value: number
  currency: string
  contentIds: string[]
  productPixelId?: string
  productCapiToken?: string
  paymentMethod?: string
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

    // Sepay (chuyển khoản) → đã thanh toán thật → bắn Purchase ngay
    // COD → chưa chắc giao được → bắn CompleteRegistration, Purchase bắn sau khi Pancake status=3
    const eventName = paymentMethod === "sepay" ? "Purchase" : "CompleteRegistration"

    if (window.fbq) {
      window.fbq("track", eventName, customData, { eventID: eventId })
    }

    // CAPI → pixel chung
    sendCAPIViaRoute({
      eventName,
      eventId,
      eventSourceUrl: window.location.href,
      customData,
    })

    // CAPI → pixel riêng sản phẩm (nếu có)
    if (productPixelId && productCapiToken) {
      sendCAPIViaRoute({
        eventName,
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
