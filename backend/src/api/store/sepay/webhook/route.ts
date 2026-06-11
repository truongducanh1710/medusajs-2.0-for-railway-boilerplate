import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { sendPurchaseEvent, sendCompleteRegistrationEvent } from "../../../../lib/fb-capi"

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
 * SePay gọi endpoint này khi có giao dịch chuyển khoản vào tài khoản
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = req.body as any

    // Log để debug
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

      // Bắn FB CAPI CompleteRegistration + Purchase khi thanh toán SePay thành công
      try {
        const meta = order.metadata ?? {}

        // Load store metadata để lấy PX_CHUNG pixel/token
        let storePixelId: string | undefined
        let storeCapiToken: string | undefined
        try {
          const storeService = req.scope.resolve(Modules.STORE) as any
          const stores = await storeService.listStores({}, { select: ["id", "metadata"] })
          const storeMeta = stores?.[0]?.metadata ?? {}
          storePixelId = storeMeta.fb_pixel_id
          storeCapiToken = storeMeta.fb_capi_token
        } catch {}

        // Load product metadata từ item đầu tiên để lấy pixel riêng sản phẩm
        let productPixelId: string | undefined
        let productCapiToken: string | undefined
        try {
          const productService = req.scope.resolve(Modules.PRODUCT) as any
          const firstItem = order.items?.[0]
          const variantId = firstItem?.variant_id
          if (variantId) {
            const variants = await productService.listProductVariants({ id: [variantId] }, { select: ["id", "product_id"] })
            const productId = variants?.[0]?.product_id
            if (productId) {
              const products = await productService.listProducts({ id: [productId] }, { select: ["id", "metadata"] })
              const pMeta = products?.[0]?.metadata ?? {}
              productPixelId = pMeta.fb_pixel_id
              productCapiToken = pMeta.fb_capi_token
            }
          }
        } catch {}

        const shippingAddr = order.shipping_address ?? {}
        const fullName = shippingAddr.first_name
          ? `${shippingAddr.first_name} ${shippingAddr.last_name ?? ""}`.trim()
          : undefined
        const contentIds = (order.items ?? []).map((i: any) => i.variant_id || i.id).filter(Boolean)
        const value = Number(order.total ?? transferAmount)

        const capiBase = {
          orderId: order.id,
          phone: shippingAddr.phone,
          email: order.email,
          customerName: fullName,
          city: shippingAddr.city,
          fbclid: meta.fbclid,
          fbp: meta.fbp,
          fbc: meta.fbc,
          client_ip_address: meta.client_ip_address,
          client_user_agent: meta.client_user_agent,
          value,
          contentIds,
          storePixelId,
          storeCapiToken,
          productPixelId,
          productCapiToken,
        }

        // CompleteRegistration (nếu chưa bắn — dedup bởi event_id)
        await sendCompleteRegistrationEvent({
          ...capiBase,
          utmCampaign: meta.utm_campaign,
          utmContent: meta.utm_content,
          utmSource: meta.utm_source,
          utmMedium: meta.utm_medium,
          campaignId: meta.fb_campaign_id,
          adsetId: meta.fb_adset_id,
          adId: meta.fb_ad_id,
        })

        // Purchase — bắn ngay khi thanh toán xong, không đợi giao hàng
        await sendPurchaseEvent(capiBase)

      } catch (capiErr: any) {
        console.warn("[SePay Webhook] CAPI error:", capiErr.message)
      }

    } catch (orderErr: any) {
      console.error("[SePay Webhook] Lỗi cập nhật order:", orderErr.message)
    }

    // Luôn trả 200 để SePay không retry
    return res.json({ success: true })

  } catch (err: any) {
    logSePayWebhook("POST failed", err)
    // Vẫn trả 200 để SePay không retry liên tục
    return res.json({ success: true })
  }
}
