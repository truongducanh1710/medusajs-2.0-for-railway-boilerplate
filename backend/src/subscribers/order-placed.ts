import { Modules } from '@medusajs/framework/utils'
import { INotificationModuleService, IOrderModuleService, IProductModuleService } from '@medusajs/framework/types'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/medusa'
import { EmailTemplates } from '../modules/email-notifications/templates'
import { pushOrderToPancake } from '../lib/pancake'
import { sendCompleteRegistrationEvent } from '../lib/fb-capi'

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<any>) {
  const notificationModuleService: INotificationModuleService = container.resolve(Modules.NOTIFICATION)
  const orderModuleService: IOrderModuleService = container.resolve(Modules.ORDER)
  const productService: IProductModuleService = container.resolve(Modules.PRODUCT)

  const order = await orderModuleService.retrieveOrder(data.id, {
    select: ['id', 'email', 'currency_code', 'total', 'subtotal', 'shipping_total', 'discount_total', 'tax_total', 'metadata', 'created_at'] as any,
    relations: ['items', 'summary', 'shipping_address'],
  })
  const shippingAddress = await (orderModuleService as any).orderAddressService_.retrieve(order.shipping_address.id)

  // Enrich order items với variant SKU từ product module
  const variantIds = (order.items || []).map((item: any) => item.variant_id).filter(Boolean)
  if (variantIds.length > 0) {
    try {
      const variants = await productService.listProductVariants({ id: variantIds }, { select: ['id', 'sku'] })
      const skuMap = new Map(variants.map((v: any) => [v.id, v.sku]))
      for (const item of order.items as any[]) {
        if (item.variant_id && skuMap.has(item.variant_id)) {
          item.variant = { sku: skuMap.get(item.variant_id) }
        }
      }
    } catch (e: any) {
      console.error('[Pancake] Failed to enrich variant SKUs:', e.message)
    }
  }

  try {
    await notificationModuleService.createNotifications({
      to: order.email,
      channel: 'email',
      template: EmailTemplates.ORDER_PLACED,
      data: {
        emailOptions: {
          replyTo: 'info@example.com',
          subject: 'Your order has been placed'
        },
        order,
        shippingAddress,
        preview: 'Thank you for your order!'
      }
    })
  } catch (error) {
    console.error('Error sending order confirmation notification:', error)
  }

  // Bắn CompleteRegistration ngay khi order created — không đợi trang thank-you hay Pancake webhook
  try {
    const meta = (order.metadata ?? {}) as Record<string, any>
    const total = Number((order as any).total ?? 0)
    const contentIds = (order.items as any[]).map((i: any) => i.variant_id || i.id).filter(Boolean)
    const fullName = shippingAddress?.first_name
      ? `${shippingAddress.first_name} ${shippingAddress.last_name ?? ""}`.trim()
      : undefined

    await sendCompleteRegistrationEvent({
      orderId: order.id,
      phone: shippingAddress?.phone,
      email: order.email,
      customerName: fullName,
      city: shippingAddress?.city,
      fbclid: meta.fbclid,
      fbp: meta.fbp,
      fbc: meta.fbc,
      client_ip_address: meta.client_ip_address,
      client_user_agent: meta.client_user_agent,
      value: total,
      contentIds,
      utmCampaign: meta.utm_campaign,
      utmContent: meta.utm_content,
      utmSource: meta.utm_source,
      utmMedium: meta.utm_medium,
      campaignId: meta.fb_campaign_id,
      adsetId: meta.fb_adset_id,
      adId: meta.fb_ad_id,
    })
  } catch (capiErr: any) {
    console.error('[FB CAPI] CompleteRegistration error in order-placed:', capiErr.message)
  }

  try {
    const pancakeResult = await pushOrderToPancake(order, shippingAddress)
    if (pancakeResult) {
      const pancakeOrderId = pancakeResult?.id ?? pancakeResult?.order?.id ?? pancakeResult?.data?.id
      if (pancakeOrderId) {
        await orderModuleService.updateOrders([{ id: order.id, metadata: { ...order.metadata, pancake_order_id: String(pancakeOrderId) } }] as any)
        console.info(`[Pancake] Saved pancake_order_id=${pancakeOrderId} to order ${order.id}`)
      }
    }
  } catch (error: any) {
    console.error('[Pancake] Error pushing order to Pancake POS:', error?.message || error)
  }
}

export const config: SubscriberConfig = {
  event: 'order.placed'
}
