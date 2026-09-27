import { Modules } from '@medusajs/framework/utils'
import { pushOrderToPancake } from './pancake'
import { notifyTelegramByEmail } from './notify'

// Đẩy đơn web sang Pancake và GHI LẠI kết quả vào chính đơn đó.
//
// Trước đây lỗi đẩy đơn chỉ nằm trong log server: từ 29/07 đến 27/09 có 6 đơn
// web không vào được Pancake mà không ai biết — sale không gọi, kho không giao.
// Giờ mọi kết quả đều lưu vào order.metadata và lỗi thì nhắn Telegram ngay.

// Người nhận cảnh báo đơn web không vào được Pancake — luôn kèm SUPER_ADMIN_EMAIL.
const NHAN_CANH_BAO = (process.env.ORDER_PUSH_ALERT_EMAILS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)

/** Nạp đơn Medusa đủ dữ liệu để đẩy sang Pancake (items + SKU + địa chỉ). */
export async function loadOrderForPancake(container: any, orderId: string) {
  const orderModuleService: any = container.resolve(Modules.ORDER)
  const productService: any = container.resolve(Modules.PRODUCT)

  const order = await orderModuleService.retrieveOrder(orderId, {
    select: ['id', 'display_id', 'email', 'currency_code', 'total', 'subtotal', 'shipping_total',
             'discount_total', 'tax_total', 'metadata', 'created_at'] as any,
    relations: ['items', 'summary', 'shipping_address'],
  })
  const shippingAddress = await orderModuleService.orderAddressService_.retrieve(order.shipping_address.id)

  const variantIds = (order.items || []).map((item: any) => item.variant_id).filter(Boolean)
  if (variantIds.length > 0) {
    const variants = await productService.listProductVariants({ id: variantIds }, { select: ['id', 'sku', 'product_id'] })
    const variantMap = new Map(variants.map((v: any) => [v.id, v]))
    for (const item of order.items as any[]) {
      const v: any = item.variant_id ? variantMap.get(item.variant_id) : undefined
      if (v) item.variant = { sku: v.sku, product_id: v.product_id }
    }
  }
  return { order, shippingAddress }
}

export type KetQuaDay = { ok: boolean; pancakeOrderId?: string; hetHang?: boolean; loi?: string }

/** Đẩy đơn + ghi kết quả vào metadata + nhắn Telegram nếu lỗi. Không bao giờ throw. */
export async function pushAndRecord(container: any, order: any, shippingAddress: any): Promise<KetQuaDay> {
  const orderModuleService: any = container.resolve(Modules.ORDER)
  const luu = async (patch: Record<string, any>) => {
    try {
      // Đọc lại metadata mới nhất rồi merge — tránh ghi đè trường khác
      const cur = await orderModuleService.retrieveOrder(order.id, { select: ['id', 'metadata'] as any })
      await orderModuleService.updateOrders([{ id: order.id, metadata: { ...(cur.metadata || {}), ...patch } }])
    } catch (e: any) {
      console.error(`[Pancake] Không lưu được kết quả vào đơn ${order.id}: ${e.message}`)
    }
  }

  try {
    const result = await pushOrderToPancake(order, shippingAddress)
    const id = result?.id ?? result?.order?.id ?? result?.data?.id
    if (!id) throw new Error('Pancake không trả về mã đơn')
    await luu({
      pancake_order_id: String(id),
      pancake_pushed_at: new Date().toISOString(),
      pancake_push_error: null,
      ...(result?._het_hang ? { pancake_het_hang: true } : {}),
    })
    console.info(`[Pancake] Saved pancake_order_id=${id} to order ${order.id}${result?._het_hang ? ' (hết hàng)' : ''}`)
    return { ok: true, pancakeOrderId: String(id), hetHang: !!result?._het_hang }
  } catch (err: any) {
    const loi = String(err?.message || err).slice(0, 500)
    console.error(`[Pancake] Error pushing order ${order.id} to Pancake POS: ${loi}`)
    await luu({ pancake_push_error: loi, pancake_push_failed_at: new Date().toISOString() })

    try {
      const userModule = container.resolve(Modules.USER)
      const nguoiNhan = [process.env.SUPER_ADMIN_EMAIL, ...NHAN_CANH_BAO].filter(Boolean) as string[]
      const utm = order.metadata?.utm_source ? `\nCamp: ${order.metadata.utm_source}` : ''
      await notifyTelegramByEmail(
        userModule,
        nguoiNhan,
        `🔴 <b>ĐƠN WEB KHÔNG VÀO ĐƯỢC PANCAKE</b>\n\nĐơn #${order.display_id ?? order.id}` +
          `\nSĐT: ${shippingAddress?.phone || '?'}${utm}\n\nLỗi: ${loi.slice(0, 300)}` +
          `\n\n→ Đơn chưa có trên POS, sale chưa thấy. Đẩy lại tại /admin/pancake-sync/repush-order.`,
        'pancake-push-error'
      )
    } catch {}
    return { ok: false, loi }
  }
}
