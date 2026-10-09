"use client"

import { useEffect } from "react"
import { sendCAPIViaRoute } from "@lib/pixel"
import { getUtmFromCookie } from "@lib/utm"
import { ttqTrack } from "@lib/tiktok"

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

    // event_id cố định theo orderId để dedup với CAPI backend
    // Backend dùng "purchase_{orderId}" → cùng key → FB chỉ tính 1 lần
    const eventId = `${eventName.toLowerCase()}_${orderId}`

    if (window.fbq) {
      window.fbq("track", eventName, customData, { eventID: eventId })
    }

    // TikTok — no server-side follow-up, so every order (COD + Sepay) counts
    // as PlaceAnOrder + CompletePayment for ads optimization
    const ttData = {
      contents: contentIds.map((id) => ({ content_id: id, content_type: "product" })),
      value,
      currency,
    }
    ttqTrack("PlaceAnOrder", ttData, `placeorder_${orderId}`)
    ttqTrack("CompletePayment", ttData, `completepayment_${orderId}`)

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
