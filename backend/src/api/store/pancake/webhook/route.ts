import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Pancake order status → Medusa fulfillment_status mapping
const PANCAKE_TO_FULFILLMENT: Record<number, string> = {
  0: "not_fulfilled",   // Chờ xử lý
  1: "not_fulfilled",   // Đã xác nhận
  2: "not_fulfilled",   // Đang đóng gói
  3: "not_fulfilled",   // Chờ giao hàng
  4: "shipped",         // Đang giao
  5: "fulfilled",       // Hoàn thành
  [-1]: "canceled",     // Đã hủy
  [-2]: "returned",     // Hoàn hàng
}

/**
 * POST /store/pancake/webhook
 * Pancake POS gọi endpoint này khi đơn hàng cập nhật trạng thái
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as any

  // Log toàn bộ payload để biết cấu trúc Pancake gửi
  console.log("[Pancake Webhook] RAW BODY:", JSON.stringify(body, null, 2))

  try {
    // Pancake thường gửi dạng: { id, status, ... } hoặc { order: { id, status } }
    const pancakeOrder = body?.order ?? body
    const pancakeOrderId = String(pancakeOrder?.id ?? "")
    const pancakeStatus: number = Number(pancakeOrder?.status ?? pancakeOrder?.order_status ?? -999)

    console.log("[Pancake Webhook] order_id:", pancakeOrderId, "status:", pancakeStatus)

    if (!pancakeOrderId || pancakeStatus === -999) {
      console.warn("[Pancake Webhook] Không đọc được order_id hoặc status từ payload")
      return res.json({ success: true, message: "logged" })
    }

    const fulfillmentStatus = PANCAKE_TO_FULFILLMENT[pancakeStatus]
    console.log("[Pancake Webhook] → fulfillment_status:", fulfillmentStatus ?? "unknown")

    // Tìm Medusa order có pancake_order_id trong metadata
    try {
      const orderService = req.scope.resolve("orderModuleService") as any
      const orders = await orderService.listOrders(
        {},
        { take: 1, skip: 0 }
      )

      // listOrders không filter theo metadata — cần dùng query trực tiếp
      // Tìm bằng cách list gần đây và filter
      const allOrders = await orderService.listOrders(
        {},
        { take: 200, order: { created_at: "DESC" } }
      )

      const medusaOrder = allOrders.find(
        (o: any) => String(o.metadata?.pancake_order_id) === pancakeOrderId
      )

      if (!medusaOrder) {
        console.warn("[Pancake Webhook] Không tìm thấy Medusa order với pancake_order_id:", pancakeOrderId)
        return res.json({ success: true, message: "order not found" })
      }

      console.log("[Pancake Webhook] Tìm thấy order:", medusaOrder.id, "display_id:", medusaOrder.display_id)

      // Update metadata với trạng thái Pancake mới nhất
      await orderService.updateOrders([{
        id: medusaOrder.id,
        metadata: {
          ...medusaOrder.metadata,
          pancake_status: pancakeStatus,
          pancake_status_updated_at: new Date().toISOString(),
        }
      }])

      console.log("[Pancake Webhook] ✅ Updated order", medusaOrder.display_id, "pancake_status →", pancakeStatus)

    } catch (orderErr: any) {
      console.error("[Pancake Webhook] Lỗi cập nhật order:", orderErr.message)
    }

    return res.json({ success: true })

  } catch (err: any) {
    console.error("[Pancake Webhook] Error:", err.message)
    return res.json({ success: true }) // Luôn 200 để Pancake không retry
  }
}
