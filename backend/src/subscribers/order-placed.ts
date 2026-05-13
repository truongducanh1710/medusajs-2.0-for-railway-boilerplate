import { Modules } from '@medusajs/framework/utils'
import { INotificationModuleService, IOrderModuleService, IProductModuleService } from '@medusajs/framework/types'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/medusa'
import { EmailTemplates } from '../modules/email-notifications/templates'
import { pushOrderToPancake } from '../lib/pancake'

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<any>) {
  const notificationModuleService: INotificationModuleService = container.resolve(Modules.NOTIFICATION)
  const orderModuleService: IOrderModuleService = container.resolve(Modules.ORDER)
  const productService: IProductModuleService = container.resolve(Modules.PRODUCT)

  const order = await orderModuleService.retrieveOrder(data.id, { relations: ['items', 'summary', 'shipping_address'] })
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
