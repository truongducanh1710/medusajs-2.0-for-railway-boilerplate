import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { addToCartWorkflow, deleteLineItemsWorkflow } from "@medusajs/medusa/core-flows"
import { GROUPS, groupLineUpdates, groupUnitPrice, productGroup } from "../../../../../lib/bundle-group"

const bad = (message: string): never => { throw new MedusaError(MedusaError.Types.INVALID_DATA, message) }

/**
 * Replace the cart's lines of one product group (ICEgel shop) with the customer's picks:
 * body { group, items: [{ variant_id, quantity }], gift_picks: string[] }.
 * Prices, tier fee and gifts are written server-side from product metadata (lib/bundle-group).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as any
    const group = GROUPS[String(body.group ?? "")] ?? bad("Nhóm sản phẩm không hợp lệ.")
    const rawItems = Array.isArray(body.items) ? body.items : bad("Thiếu danh sách sản phẩm.")
    const wanted = new Map<string, number>()
    for (const entry of rawItems) {
      const variantId = typeof entry?.variant_id === "string" ? entry.variant_id : bad("Sản phẩm không hợp lệ.")
      const qty = Number(entry?.quantity)
      if (!Number.isSafeInteger(qty) || qty < 1) bad("Số lượng không hợp lệ.")
      wanted.set(variantId, (wanted.get(variantId) ?? 0) + qty)
    }
    const total = [...wanted.values()].reduce((sum, qty) => sum + qty, 0)
    if (total < 1) bad("Vui lòng chọn ít nhất 1 hộp.")
    if (total > group.maxBoxes) bad(`Mỗi đơn ${group.label} tối đa ${group.maxBoxes} hộp.`)
    const giftPicks = (Array.isArray(body.gift_picks) ? body.gift_picks : [])
      .filter((key: unknown) => group.giftChoices.some((choice) => choice.key === key))
      .slice(0, 20)

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["id", "completed_at", "currency_code", "items.id", "items.variant_id"],
      filters: { id: req.params.id },
    })
    const cart = carts?.[0]
    if (!cart) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Không tìm thấy giỏ hàng.")
    if (cart.completed_at) bad("Giỏ hàng đã đặt xong.")
    if (cart.currency_code !== "vnd") bad("Chỉ hỗ trợ thanh toán bằng VND.")

    const productService = req.scope.resolve(Modules.PRODUCT) as any
    const variantIds = [...new Set([...wanted.keys(), ...(cart.items ?? []).map((item: any) => item.variant_id).filter(Boolean)])]
    const variants = variantIds.length ? await productService.listProductVariants({ id: variantIds }, { select: ["id", "product_id"] }) : []
    const productIds = [...new Set(variants.map((variant: any) => variant.product_id))]
    const products = productIds.length ? await productService.listProducts({ id: productIds }, { select: ["id", "metadata", "status"] }) : []
    const productOfVariant = new Map(variants.map((variant: any) => [variant.id, products.find((product: any) => product.id === variant.product_id)]))

    for (const variantId of wanted.keys()) {
      const product: any = productOfVariant.get(variantId)
      if (!product || product.status !== "published" || productGroup(product.metadata)?.key !== group.key || !groupUnitPrice(product.metadata)) {
        bad("Có sản phẩm không còn bán. Vui lòng tải lại trang.")
      }
    }

    // Replace this group's lines wholesale: simpler and race-free compared to per-line diffs
    const staleIds = (cart.items ?? [])
      .filter((item: any) => productGroup((productOfVariant.get(item.variant_id) as any)?.metadata)?.key === group.key)
      .map((item: any) => item.id)
    if (staleIds.length) await deleteLineItemsWorkflow(req.scope).run({ input: { cart_id: cart.id, ids: staleIds } })

    await addToCartWorkflow(req.scope).run({
      input: {
        cart_id: cart.id,
        items: [...wanted.entries()].map(([variantId, quantity]) => ({
          variant_id: variantId,
          quantity,
          unit_price: groupUnitPrice((productOfVariant.get(variantId) as any).metadata)!,
          metadata: { bundle_group: group.key, gift_picks: giftPicks },
        })),
      },
    })

    const { data: fresh } = await query.graph({
      entity: "cart",
      fields: ["id", "items.id", "items.variant_id", "items.quantity", "items.unit_price", "items.is_custom_price", "items.metadata"],
      filters: { id: cart.id },
    })
    const updates = groupLineUpdates((fresh[0]?.items ?? []).map((item: any) => ({
      item,
      productMetadata: (productOfVariant.get(item.variant_id) as any)?.metadata,
    })))
    if (updates.length) await (req.scope.resolve(Modules.CART) as any).updateLineItems(updates)

    const { data } = await query.graph({
      entity: "cart",
      fields: ["*", "items.*", "items.metadata", "shipping_methods.*"],
      filters: { id: cart.id },
    })
    return res.status(200).json({ cart: data[0] })
  } catch (error: any) {
    return res.status(error?.type === MedusaError.Types.NOT_FOUND ? 404 : 400).json({ message: error?.message || "Không cập nhật được giỏ hàng." })
  }
}
