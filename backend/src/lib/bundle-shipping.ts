import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"
import { groupLineUpdates, groupShippingQuote, groupUnitPrice, phoneKey, productGroup, type ShipContext, type ShipQuote } from "./bundle-group"

const invalid = (message: string): never => { throw new MedusaError(MedusaError.Types.INVALID_DATA, message) }
const parse = (value: any): any => {
  if (typeof value !== "string") return value
  try { return JSON.parse(value) } catch { return undefined }
}

export type BundleShippingPlan = {
  fee: number
  goodsTotal: number
  optionId: string
  profileId: string
  productIds: string[]
  /** Why a group cart pays this fee (absent for single-product combos) */
  shipReason?: ShipQuote["reason"]
}

/**
 * Server gifts of a configured offer. With offer.giftChoice ({ items: [...] }) the customer's pick
 * (line metadata gift_choice = item name) goes first; an unknown or missing pick falls back to item 0.
 */
export function configuredOfferGifts(offer: any, pickName?: unknown): any[] {
  const base = Array.isArray(offer?.gifts) ? offer.gifts : []
  const items = Array.isArray(offer?.giftChoice?.items) ? offer.giftChoice.items.filter((g: any) => g && typeof g.name === "string" && g.name.trim()) : []
  if (items.length < 2) return base
  const picked = items.find((g: any) => g.name === pickName) ?? items[0]
  const gift = { name: picked.name, value: Number(picked.value) || 0, ...(picked.image ? { image: picked.image } : {}), ...(picked.sku ? { sku: picked.sku } : {}) }
  return [gift, ...base]
}

/** Normalize only configured offers; return null once the native line is settled. */
export function configuredBundleLineUpdate(item: any, productMetadata: any) {
  const offers = parse(productMetadata?.bundle_options)
  if (!Array.isArray(offers) || !offers.some((offer: any) => Object.prototype.hasOwnProperty.call(offer, "shippingFee"))) return null
  const qty = Number(item.quantity)
  const offer = offers.find((entry: any) => Number(entry.qty) === qty)
  if (!Number.isSafeInteger(qty) || qty < 1 || !offer || !Number.isSafeInteger(offer.price) || offer.price <= 0 || !Number.isSafeInteger(offer.shippingFee) || offer.shippingFee < 0) invalid("Số lượng combo chưa được cấu hình hợp lệ.")
  const unitPrice = offer.price / qty
  const giftJson = JSON.stringify(configuredOfferGifts(offer, item.metadata?.gift_choice))
  const metadata = { ...(item.metadata ?? {}), bundle_qty: qty, bundle_price: offer.price, bundle_shipping_fee: offer.shippingFee, gifts: giftJson }
  if (Math.abs(Number(item.unit_price) - unitPrice) <= 0.000001 && item.is_custom_price === true && Number(item.metadata?.bundle_qty) === qty && Number(item.metadata?.bundle_price) === offer.price && Number(item.metadata?.bundle_shipping_fee) === offer.shippingFee && item.metadata?.gifts === giftJson) return null
  return { id: item.id, unit_price: unitPrice, is_custom_price: true, metadata }
}

/**
 * Quantity price tiers of one variant from product.metadata.bundle_options_v2
 * ({ variants: [{ variantId, options: [{ qty, price, label }], strict_qty }] }).
 * Only a table with 2+ options is a tier table; single-option configs keep legacy behavior.
 */
export function variantTierConfig(productMetadata: any, variantId?: string | null) {
  const v2 = parse(productMetadata?.bundle_options_v2)
  const config = Array.isArray(v2?.variants) ? v2.variants.find((entry: any) => entry?.variantId === variantId) : null
  const options = (Array.isArray(config?.options) ? config.options : []).filter((option: any) =>
    Number.isSafeInteger(option?.qty) && option.qty >= 1 && Number.isSafeInteger(option?.price) && option.price > 0)
  if (options.length < 2) return null
  return { options, strict: config.strict_qty === true }
}

/** Server-authoritative price for a tiered line: the client's bundle_price is never trusted. */
export function variantTierLineUpdate(item: any, productMetadata: any) {
  const tiers = variantTierConfig(productMetadata, item.variant_id)
  if (!tiers) return null
  const qty = Number(item.quantity)
  const offer = tiers.options.find((option: any) => option.qty === qty)
  if (!offer) {
    if (tiers.strict) invalid("Số lượng này chưa có giá. Vui lòng chọn lại số lượng.")
    return null
  }
  const unitPrice = offer.price / qty
  const label = typeof offer.label === "string" && offer.label ? offer.label : item.metadata?.bundle_label
  const metadata = { ...(item.metadata ?? {}), bundle_qty: qty, bundle_price: offer.price, bundle_tier: true, ...(label ? { bundle_label: label } : {}) }
  if (Math.abs(Number(item.unit_price) - unitPrice) <= 0.000001 && item.is_custom_price === true && Number(item.metadata?.bundle_qty) === qty && Number(item.metadata?.bundle_price) === offer.price && item.metadata?.bundle_tier === true && item.metadata?.bundle_label === label) return null
  return { id: item.id, unit_price: unitPrice, is_custom_price: true, metadata }
}

/** Only server product metadata activates shipping rules; line metadata cannot opt out. */
export function deriveBundleShippingPlan(cart: any, products: any[], variants: any[], ship: ShipContext = {}): BundleShippingPlan | null {
  const productMap = new Map(products.map((product: any) => [product.id, product]))
  const variantMap = new Map(variants.map((variant: any) => [variant.id, variant]))
  const lines = (cart.items ?? []).map((item: any) => {
    const product: any = productMap.get((variantMap.get(item.variant_id) as any)?.product_id)
    const offers = parse(product?.metadata?.bundle_options)
    const group = productGroup(product?.metadata)
    const configured = !!group || (Array.isArray(offers) && offers.some((offer: any) => Object.prototype.hasOwnProperty.call(offer, "shippingFee")))
    return { item, product, offers, configured, group }
  })
  // Cross-product groups: the tier depends on the total boxes of the group in this cart
  const groupBoxes = new Map<string, number>()
  for (const line of lines) if (line.group) groupBoxes.set(line.group.key, (groupBoxes.get(line.group.key) ?? 0) + Number(line.item.quantity))
  if (!lines.some((line: any) => line.configured)) return null
  if (cart.currency_code !== "vnd") invalid("Combo này chỉ hỗ trợ thanh toán bằng VND.")
  if (lines.some((line: any) => !line.configured)) invalid("Vui lòng đặt combo này riêng với sản phẩm khác.")

  let fee = 0
  let goodsTotal = 0
  let profileId = ""
  let shipReason: ShipQuote["reason"] | undefined
  const maps: Record<string, string>[] = []
  const productIds: string[] = []
  for (const { item, product, offers, group } of lines) {
    const qty = Number(item.quantity)
    const declaredQty = Number(item.metadata?.bundle_qty)
    if (!Number.isSafeInteger(qty) || qty < 1 || declaredQty !== qty) invalid("Số lượng combo không hợp lệ.")
    let offer: any
    if (group) {
      const boxes = groupBoxes.get(group.key) ?? 0
      const unitPrice = groupUnitPrice(product.metadata)
      if (boxes > group.maxBoxes) invalid(`Mỗi đơn ${group.label} tối đa ${group.maxBoxes} hộp.`)
      if (!unitPrice) invalid("Sản phẩm chưa được cấu hình giá.")
      const quote = groupShippingQuote(group, boxes, { province: cart.shipping_address?.city, ...ship })
      shipReason = quote.reason
      offer = { price: unitPrice! * qty, shippingFee: quote.fee }
    } else {
      offer = offers.find((entry: any) => Number(entry.qty) === qty)
    }
    if (!offer || !Number.isSafeInteger(offer.price) || offer.price <= 0 || !Number.isSafeInteger(offer.shippingFee) || offer.shippingFee < 0) invalid("Combo chưa được cấu hình giá và phí vận chuyển hợp lệ.")
    if (Number(item.metadata?.bundle_price) !== offer.price) invalid("Giá combo đã thay đổi. Vui lòng chọn lại combo.")
    if (!Number.isFinite(Number(item.unit_price)) || Math.abs(Number(item.unit_price) * qty - offer.price) > 1) invalid("Giá trong giỏ chưa cập nhật. Vui lòng thử lại sau ít giây.")
    if ((item.adjustments ?? []).some((adjustment: any) => Number(adjustment.amount ?? 0) !== 0)) invalid("Combo này không áp dụng thêm mã giảm giá.")
    if (!product.shipping_profile_id || (profileId && profileId !== product.shipping_profile_id)) invalid("Không thể gộp các combo có cách giao hàng khác nhau.")
    profileId = product.shipping_profile_id
    const optionMap = parse(product.metadata?.bundle_shipping_option_ids)
    if (!optionMap || typeof optionMap !== "object" || Array.isArray(optionMap)) invalid("Combo chưa được cấu hình vận chuyển.")
    maps.push(optionMap)
    productIds.push(product.id)
    fee = Math.max(fee, offer.shippingFee)
    goodsTotal += offer.price
  }
  const optionId = maps[0]?.[String(fee)]
  if (typeof optionId !== "string" || !optionId || maps.some((map) => map[String(fee)] !== optionId)) invalid("Các combo chưa có phương thức giao chung.")
  return { fee, goodsTotal, optionId, profileId, productIds, ...(shipReason ? { shipReason } : {}) }
}

/**
 * True when no earlier order (web or Pancake POS, cancelled/deleted ones excepted) used this phone.
 * The cart's own order is ignored, so re-validating after checkout (Sepay webhook) keeps the same fee.
 */
export async function isNewCustomerPhone(scope: any, phone: unknown, cartId?: string): Promise<boolean> {
  const key = phoneKey(phone)
  if (!key) return false
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const like = `%${key}`
  // The cart's own order and the POS copy it was pushed to (order.metadata.pancake_order_id)
  const own: { id: string; pos: string | null }[] = cartId
    ? (await pg.raw(
        `SELECT o.id, o.metadata->>'pancake_order_id' AS pos FROM order_cart oc JOIN "order" o ON o.id = oc.order_id
          WHERE oc.cart_id = ? AND oc.deleted_at IS NULL`, [cartId])).rows
    : []
  const ownIds = own.map((o) => o.id)
  const ownPos = own.map((o) => o.pos).filter((v): v is string => !!v)
  const list = (n: number) => Array(n).fill("?").join(",")
  const web = await pg.raw(
    `SELECT 1 FROM "order" o JOIN order_address a ON a.id = o.shipping_address_id
      WHERE o.deleted_at IS NULL AND o.status <> 'canceled' AND regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') LIKE ?
        ${ownIds.length ? `AND o.id NOT IN (${list(ownIds.length)})` : ""} LIMIT 1`,
    [like, ...ownIds])
  if (web.rows.length) return false
  const pos = await pg.raw(
    `SELECT 1 FROM pancake_order WHERE deleted_at IS NULL AND status NOT IN (6, 7)
      AND regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') LIKE ?
      ${ownPos.length ? `AND id NOT IN (${list(ownPos.length)})` : ""} LIMIT 1`,
    [like, ...ownPos])
  return !pos.rows.length
}

export async function loadBundleShippingContext(scope: any, cartId: string, normalize = false) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "currency_code", "completed_at", "metadata", "items.id", "items.variant_id", "items.title", "items.unit_price", "items.quantity", "items.metadata", "items.is_custom_price", "items.adjustments.amount", "shipping_methods.id", "shipping_methods.shipping_option_id", "shipping_methods.amount", "shipping_methods.adjustments.amount", "shipping_total", "shipping_address.*"],
    filters: { id: cartId },
  })
  const cart = data?.[0]
  if (!cart) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Không tìm thấy giỏ hàng.")
  const variantIds = [...new Set((cart.items ?? []).map((item: any) => item.variant_id).filter(Boolean))]
  if (!variantIds.length) return { cart, plan: null as BundleShippingPlan | null }
  const service = scope.resolve(Modules.PRODUCT)
  const variants = await service.listProductVariants({ id: variantIds }, { select: ["id", "product_id"] })
  const productIds = [...new Set(variants.map((variant: any) => variant.product_id))]
  // Shipping profiles are external product links, not Product module columns.
  const { data: linkedProducts } = productIds.length
    ? await query.graph({ entity: "product", fields: ["id", "metadata", "shipping_profile.id"], filters: { id: productIds } })
    : { data: [] }
  const products = linkedProducts.map((product: any) => ({ ...product, shipping_profile_id: product.shipping_profile?.id }))
  if (normalize && !cart.completed_at) {
    const variantMap = new Map(variants.map((variant: any) => [variant.id, variant.product_id]))
    const productMap = new Map(products.map((product: any) => [product.id, product]))
    const updates: any[] = []
    const groupUpdates = groupLineUpdates((cart.items ?? []).map((item: any) => ({ item, productMetadata: (productMap.get(variantMap.get(item.variant_id)) as any)?.metadata })))
    const groupUpdateIds = new Set(groupUpdates.map((update: any) => update.id))
    for (const update of groupUpdates) {
      updates.push(update)
      Object.assign((cart.items ?? []).find((item: any) => item.id === update.id), update)
    }
    for (const item of cart.items ?? []) {
      if (groupUpdateIds.has(item.id)) continue
      const product: any = productMap.get(variantMap.get(item.variant_id))
      if (productGroup(product?.metadata)) continue
      const update = configuredBundleLineUpdate(item, product?.metadata) ?? variantTierLineUpdate(item, product?.metadata)
      if (update) {
        updates.push(update)
        Object.assign(item, update)
      }
    }
    if (updates.length) await scope.resolve(Modules.CART).updateLineItems(updates)
  }
  // Address-based group shipping needs to know whether this phone has ordered before
  const needsHistory = products.some((product: any) => productGroup(product.metadata)?.shipping?.newCustomerFree)
  const ship: ShipContext = needsHistory && cart.shipping_address?.phone
    ? { isNewCustomer: await isNewCustomerPhone(scope, cart.shipping_address.phone, cart.id) }
    : {}
  return { cart, plan: deriveBundleShippingPlan(cart, products, variants, ship) }
}

export function assertBundleShippingMethods(cart: any, plan: BundleShippingPlan | null) {
  if (!plan) return
  const methods = cart.shipping_methods ?? []
  if (methods.length !== 1 || methods[0].shipping_option_id !== plan.optionId || Number(methods[0].amount) !== plan.fee || (methods[0].adjustments ?? []).some((a: any) => Number(a.amount ?? 0) !== 0)) invalid("Phí vận chuyển chưa đúng với combo. Vui lòng chọn lại combo.")
  if (Number(cart.shipping_total) !== plan.fee) invalid("Tổng phí vận chuyển chưa đúng với combo.")
  if (Number(cart.metadata?.sepay_discount ?? 0) !== 0) invalid("Combo này không áp dụng giảm thêm khi thanh toán QR.")
}

export async function validateBundleShippingCart(scope: any, cartId: string) {
  const context = await loadBundleShippingContext(scope, cartId, true)
  assertBundleShippingMethods(context.cart, context.plan)
  if (context.plan) {
    const option = await scope.resolve(Modules.FULFILLMENT).retrieveShippingOption(context.plan.optionId)
    if (option.shipping_profile_id !== context.plan.profileId || option.price_type !== "flat") invalid("Phương thức vận chuyển không phù hợp với combo.")
  }
  if (!context.plan) {
    // A client marker cannot change the fulfillment behavior of legacy products.
    const updates = (context.cart.items ?? []).filter((item: any) => Object.prototype.hasOwnProperty.call(item.metadata ?? {}, "bundle_shipping_fee")).map((item: any) => {
      const metadata = { ...(item.metadata ?? {}) }
      delete metadata.bundle_shipping_fee
      return { id: item.id, metadata }
    })
    if (updates.length) await scope.resolve(Modules.CART).updateLineItems(updates)
  }
  return context
}

/** Only configured offers write this line marker; actual fee always comes from stored methods. */
export function hasBundleShippingLines(entity: any): boolean {
  return (entity.items ?? []).some((item: any) => Object.prototype.hasOwnProperty.call(item.metadata ?? {}, "bundle_shipping_fee"))
}

export function storedBundleShippingFee(entity: any): number {
  if (!hasBundleShippingLines(entity)) return 0
  const amount = Number(entity.shipping_total ?? (entity.shipping_methods ?? []).reduce((sum: number, method: any) => sum + Number(method.amount ?? 0), 0))
  if (!Number.isFinite(amount) || amount < 0) invalid("Phí vận chuyển không hợp lệ.")
  return amount
}
