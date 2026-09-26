import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cartIdFromTransferContent, confirmSepayPayment } from "../../../../lib/sepay-order"

function logSePayWebhook(stage: string, error?: unknown, extra?: Record<string, unknown>) {
  if (!error) {
    console.info(`[SePay Webhook] ${stage}`, extra ?? {})
    return
  }

  const payload =
    error instanceof Error
      ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        }
      : { error }

  console.error(`[SePay Webhook] ${stage}`, {
    ...payload,
    ...extra,
  })
}

/**
 * POST /store/sepay/webhook
 * SePay gọi endpoint này khi có giao dịch chuyển khoản vào tài khoản.
 * Nội dung CK dạng "PV{cartId bỏ cart_}" → tìm cart, kiểm tra số tiền, tự tạo đơn
 * (khách đóng tab sau khi CK vẫn có đơn).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = req.body as any

    logSePayWebhook("POST request", undefined, {
      transferType: body?.transferType,
      accountNumber: body?.accountNumber,
      transferAmount: body?.transferAmount,
      content: body?.content,
      referenceCode: body?.referenceCode,
      code: body?.code,
      gateway: body?.gateway,
    })

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

    const cartId = cartIdFromTransferContent(content)
    if (!cartId) {
      console.log("[SePay Webhook] Không tìm thấy mã đơn trong nội dung:", content)
      return res.json({ success: true, message: "No order code found in content" })
    }

    try {
      const result = await confirmSepayPayment(req.scope, cartId, {
        amount: Number(transferAmount ?? 0),
        content,
        reference: referenceCode || code,
        transactionDate,
        gateway,
      })

      if (!result.ok) {
        console.log(`[SePay Webhook] ${result.reason}`, { cartId, expected: result.expected, received: result.received })
        return res.json({ success: true, message: result.reason })
      }

      console.log(`[SePay Webhook] ✅ Đã xác nhận thanh toán`, { cartId, orderId: result.orderId })
    } catch (orderErr: any) {
      logSePayWebhook("confirm payment failed", orderErr, { cartId })
    }

    // Luôn trả 200 để SePay không retry
    return res.json({ success: true })

  } catch (err: any) {
    logSePayWebhook("POST failed", err)
    // Vẫn trả 200 để SePay không retry liên tục
    return res.json({ success: true })
  }
}
