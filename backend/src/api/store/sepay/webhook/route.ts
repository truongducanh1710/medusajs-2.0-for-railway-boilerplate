import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /store/sepay/webhook
 * SePay gọi endpoint này khi có giao dịch chuyển khoản vào tài khoản
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = req.body as any

    // Log để debug
    console.log("[SePay Webhook]", JSON.stringify(body))

    const {
      gateway,
      transactionDate,
      accountNumber,
      transferType,
      transferAmount,
      content,
      referenceCode,
      code,
    } = body

    // Chỉ xử lý giao dịch tiền VÀO (in)
    if (transferType !== "in") {
      return res.json({ success: true, message: "Ignored: not incoming transfer" })
    }

    // Kiểm tra đúng tài khoản của shop
    const shopAccount = process.env.SEPAY_ACCOUNT_NUMBER
    if (shopAccount && accountNumber !== shopAccount) {
      return res.json({ success: true, message: "Ignored: wrong account" })
    }

    // Tìm order từ nội dung chuyển khoản
    // Nội dung thường có dạng: "PVDH20240101001" hoặc "Thanh toan don hang PVDH20240101001"
    const orderCodeMatch = content?.match(/PV[A-Z0-9]+/i) || content?.match(/DH[0-9]+/i)
    const orderCode = orderCodeMatch?.[0]?.toUpperCase()

    if (!orderCode) {
      console.log("[SePay Webhook] Không tìm thấy mã đơn hàng trong nội dung:", content)
      return res.json({ success: true, message: "No order code found in content" })
    }

    console.log(`[SePay Webhook] Tìm đơn hàng: ${orderCode}, Số tiền: ${transferAmount}`)

    // Tìm và cập nhật order trong Medusa
    try {
      const orderService = req.scope.resolve("orderModuleService") as any
      const orders = await orderService.listOrders({ display_id: orderCode })

      if (!orders || orders.length === 0) {
        console.log(`[SePay Webhook] Không tìm thấy đơn hàng: ${orderCode}`)
        return res.json({ success: true, message: "Order not found" })
      }

      const order = orders[0]

      // Kiểm tra số tiền khớp (cho phép sai lệch 1000đ do làm tròn)
      const orderTotal = order.total || 0
      const diff = Math.abs(transferAmount - orderTotal)
      if (diff > 1000) {
        console.log(`[SePay Webhook] Số tiền không khớp: nhận ${transferAmount}, cần ${orderTotal}`)
        return res.json({ success: true, message: "Amount mismatch" })
      }

      // Cập nhật metadata đơn hàng với thông tin thanh toán
      await orderService.updateOrders([{
        id: order.id,
        metadata: {
          ...order.metadata,
          payment_status: "paid",
          sepay_transaction_date: transactionDate,
          sepay_reference_code: referenceCode || code,
          sepay_amount: transferAmount,
          sepay_content: content,
          sepay_gateway: gateway,
        }
      }])

      console.log(`[SePay Webhook] ✅ Đã xác nhận thanh toán đơn hàng: ${orderCode}`)

    } catch (orderErr: any) {
      console.error("[SePay Webhook] Lỗi cập nhật order:", orderErr.message)
    }

    // Luôn trả 200 để SePay không retry
    return res.json({ success: true })

  } catch (err: any) {
    console.error("[SePay Webhook] Error:", err.message)
    // Vẫn trả 200 để SePay không retry liên tục
    return res.json({ success: true })
  }
}
