import { Modules } from "@medusajs/framework/utils"
import { ICartModuleService } from "@medusajs/framework/types"
import { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { configuredBundleLineUpdate } from "../lib/bundle-shipping"

/**
 * Configured shipping offers use product-authoritative pricing on creation and update.
 * The original underscore event retains its legacy rounded pricing behavior.
 */
export default async function cartItemBundlePriceHandler({
  event: { name, data },
  container,
}: SubscriberArgs<any>) {
  const cartService: ICartModuleService = container.resolve(Modules.CART)

  for (const itemId of Array.isArray(data.id) ? data.id : [data.id]) {
    try {
      const item = await cartService.retrieveLineItem(itemId, {
        select: ["id", "variant_id", "unit_price", "quantity", "metadata", "is_custom_price"],
      })

      if (name === "cart.line_item.created") {
        const bundlePrice = Number(item.metadata?.bundle_price ?? 0)
        const bundleQty = Number(item.metadata?.bundle_qty ?? 0) || Number(item.quantity) || 1
        if (!bundlePrice || bundleQty <= 0) continue
        const newUnitPrice = Math.round(bundlePrice / bundleQty)
        if (newUnitPrice !== Number(item.unit_price)) {
          await (cartService as any).updateLineItems([{ id: item.id, unit_price: newUnitPrice }])
        }
        continue
      }

      let productMetadata: any = {}
      if (item.variant_id) {
        const productService = container.resolve(Modules.PRODUCT) as any
        const variants = await productService.listProductVariants({ id: [item.variant_id] }, { select: ["id", "product_id"] })
        if (variants[0]?.product_id) {
          const products = await productService.listProducts({ id: [variants[0].product_id] }, { select: ["id", "metadata"] })
          productMetadata = products[0]?.metadata ?? {}
        }
      }
      const update = configuredBundleLineUpdate(item, productMetadata)
      if (update) {
        await (cartService as any).updateLineItems([update])
      }
    } catch (err: any) {
      console.error("[CartItemBundlePrice] Error:", err.message)
    }
  }
}

export const config: SubscriberConfig = {
  event: ["cart.line_item.created", "cart.line-item.created", "cart.line-item.updated"],
}
