import { Modules } from "@medusajs/framework/utils"
import { ICartModuleService } from "@medusajs/framework/types"
import { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { configuredBundleLineUpdate, variantTierConfig, variantTierLineUpdate } from "../lib/bundle-shipping"
import { productGroup } from "../lib/bundle-group"

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

      const productMetadata = await loadProductMetadata(container, item.variant_id)
      // Cross-product group lines (ICEgel) are priced cart-wide by /store/carts/:id/group-lines
      // and re-checked at checkout — never re-price them from client metadata here
      if (productGroup(productMetadata)) continue
      // Quantity tiers (bundle_options_v2 with 2+ options): price always from product metadata
      const tierUpdate = variantTierLineUpdate(item, productMetadata)
      if (tierUpdate) {
        await (cartService as any).updateLineItems([tierUpdate])
        continue
      }
      // Settled tier line: the legacy paths below must not re-price it from client metadata
      if (variantTierConfig(productMetadata, item.variant_id)?.options.some((option: any) => option.qty === Number(item.quantity))) continue

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

      const update = configuredBundleLineUpdate(item, productMetadata)
      if (update) {
        await (cartService as any).updateLineItems([update])
      }
    } catch (err: any) {
      console.error("[CartItemBundlePrice] Error:", err.message)
    }
  }
}

async function loadProductMetadata(container: any, variantId?: string | null): Promise<any> {
  if (!variantId) return {}
  const productService = container.resolve(Modules.PRODUCT) as any
  const variants = await productService.listProductVariants({ id: [variantId] }, { select: ["id", "product_id"] })
  if (!variants[0]?.product_id) return {}
  const products = await productService.listProducts({ id: [variants[0].product_id] }, { select: ["id", "metadata"] })
  return products[0]?.metadata ?? {}
}

export const config: SubscriberConfig = {
  event: ["cart.line_item.created", "cart.line-item.created", "cart.line-item.updated"],
}
