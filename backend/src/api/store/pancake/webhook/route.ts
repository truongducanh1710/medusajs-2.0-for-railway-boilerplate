import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /store/pancake/webhook
 * Pancake POS gọi endpoint này khi có bất kỳ thay đổi nào (đơn hàng, kho, sản phẩm...)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as any

  try {
    // Pancake gửi nhiều loại event: đơn hàng có field "system_id" hoặc "id" là số + có "status"
    // Bỏ qua event kho (có "type": "variations_warehouses") và event sản phẩm (có "variations" array)
    const isWarehouseEvent = body?.type === "variations_warehouses" || body?.order_id
    const isProductEvent = Array.isArray(body?.variations) && !body?.system_id

    if (isWarehouseEvent || isProductEvent) {
      // Không phải đơn hàng — bỏ qua im lặng
      return res.json({ success: true })
    }

    // Đơn hàng Pancake: có "system_id" (số nguyên) hoặc "id" (số nguyên) + "status"
    const pancakeOrderId = String(body?.system_id || body?.id || "")
    const pancakeStatus: number = Number(body?.status ?? -999)
    const isOrderEvent = /^\d+$/.test(pancakeOrderId) && pancakeStatus !== -999

    if (!isOrderEvent) {
      return res.json({ success: true })
    }

    // Đọc tên trạng thái trực tiếp từ Pancake payload — không cần hardcode map
    const statusLabel: string = body?.status_name || `status_${pancakeStatus}`
    console.log(`[Pancake Webhook] ✅ Đơn #${pancakeOrderId} → ${statusLabel} (${pancakeStatus})`)

    // Tìm Medusa order có metadata.pancake_order_id khớp
    try {
      const orderService = req.scope.resolve("orderModuleService") as any

      // Lấy các đơn gần đây (200 đơn) và filter theo pancake_order_id
      const orders = await orderService.listOrders(
        {},
        { take: 200, order: { created_at: "DESC" } }
      )

      const medusaOrder = orders.find(
        (o: any) => String(o.metadata?.pancake_order_id) === pancakeOrderId
      )

      if (!medusaOrder) {
        console.warn(`[Pancake Webhook] Không tìm thấy Medusa order cho pancake_order_id=${pancakeOrderId}`)
        return res.json({ success: true })
      }

      // Cập nhật metadata với trạng thái mới nhất từ Pancake
      await orderService.updateOrders([{
        id: medusaOrder.id,
        metadata: {
          ...medusaOrder.metadata,
          pancake_status: pancakeStatus,
          pancake_status_name: statusLabel,
          pancake_status_updated_at: new Date().toISOString(),
          // Lưu mã vận đơn nếu có
          ...(body?.partner?.extend_code ? { vtp_tracking: body.partner.extend_code } : {}),
        }
      }])

      console.log(`[Pancake Webhook] ✅ Updated Medusa order #${medusaOrder.display_id} (${medusaOrder.id}) → ${statusLabel}`)

    } catch (orderErr: any) {
      console.error("[Pancake Webhook] Lỗi cập nhật order:", orderErr.message)
    }

    return res.json({ success: true })

  } catch (err: any) {
    console.error("[Pancake Webhook] Error:", err.message)
    return res.json({ success: true }) // Luôn 200 để Pancake không retry
  }
}
