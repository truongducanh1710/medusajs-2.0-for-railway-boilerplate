import { Modules } from "@medusajs/framework/utils"
import { ICartModuleService } from "@medusajs/framework/types"
import { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"

/**
 * Khi khách add item vào cart, nếu có metadata.bundle_price thì
 * override unit_price = bundle_price / bundle_qty để Medusa lưu đúng giá MKT.
 */
export default async function cartItemBundlePriceHandler({
  event: { data },
  container,
}: SubscriberArgs<any>) {
  const cartService: ICartModuleService = container.resolve(Modules.CART)

  try {
    const item = await cartService.retrieveLineItem(data.id, {
      select: ["id", "unit_price", "quantity", "metadata"],
    })

    const bundlePrice = item.metadata?.bundle_price as number | undefined
    const bundleQty = (item.metadata?.bundle_qty as number) || item.quantity

    if (!bundlePrice || bundleQty <= 0) return

    const newUnitPrice = Math.round(bundlePrice / bundleQty)
    if (newUnitPrice === item.unit_price) return

    await (cartService as any).updateLineItems([
      { id: item.id, unit_price: newUnitPrice },
    ])
  } catch (err: any) {
    console.error("[CartItemBundlePrice] Error:", err.message)
  }
}

export const config: SubscriberConfig = {
  event: "cart.line_item.created",
}
