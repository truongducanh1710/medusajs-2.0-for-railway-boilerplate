import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"

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
}

/** Normalize only configured offers; return null once the native line is settled. */
export function configuredBundleLineUpdate(item: any, productMetadata: any) {
  const offers = parse(productMetadata?.bundle_options)
  if (!Array.isArray(offers) || !offers.some((offer: any) => Object.prototype.hasOwnProperty.call(offer, "shippingFee"))) return null
  const qty = Number(item.quantity)
  const offer = offers.find((entry: any) => Number(entry.qty) === qty)
  if (!Number.isSafeInteger(qty) || qty < 1 || !offer || !Number.isSafeInteger(offer.price) || offer.price <= 0 || !Number.isSafeInteger(offer.shippingFee) || offer.shippingFee < 0) invalid("Số lượng combo chưa được cấu hình hợp lệ.")
  const unitPrice = offer.price / qty
  const giftJson = JSON.stringify(Array.isArray(offer.gifts) ? offer.gifts : [])
  const metadata = { ...(item.metadata ?? {}), bundle_qty: qty, bundle_price: offer.price, bundle_shipping_fee: offer.shippingFee, gifts: giftJson }
  if (Math.abs(Number(item.unit_price) - unitPrice) <= 0.000001 && item.is_custom_price === true && Number(item.metadata?.bundle_qty) === qty && Number(item.metadata?.bundle_price) === offer.price && Number(item.metadata?.bundle_shipping_fee) === offer.shippingFee && item.metadata?.gifts === giftJson) return null
  return { id: item.id, unit_price: unitPrice, is_custom_price: true, metadata }
}

/** Only server product metadata activates shipping rules; line metadata cannot opt out. */
export function deriveBundleShippingPlan(cart: any, products: any[], variants: any[]): BundleShippingPlan | null {
  const productMap = new Map(products.map((product: any) => [product.id, product]))
  const variantMap = new Map(variants.map((variant: any) => [variant.id, variant]))
  const lines = (cart.items ?? []).map((item: any) => {
    const product: any = productMap.get((variantMap.get(item.variant_id) as any)?.product_id)
    const offers = parse(product?.metadata?.bundle_options)
    const configured = Array.isArray(offers) && offers.some((offer: any) => Object.prototype.hasOwnProperty.call(offer, "shippingFee"))
    return { item, product, offers, configured }
  })
  if (!lines.some((line: any) => line.configured)) return null
  if (cart.currency_code !== "vnd") invalid("Combo này chỉ hỗ trợ thanh toán bằng VND.")
  if (lines.some((line: any) => !line.configured)) invalid("Vui lòng đặt combo này riêng với sản phẩm khác.")

  let fee = 0
  let goodsTotal = 0
  let profileId = ""
  const maps: Record<string, string>[] = []
  const productIds: string[] = []
  for (const { item, product, offers } of lines) {
    const qty = Number(item.quantity)
    const declaredQty = Number(item.metadata?.bundle_qty)
    if (!Number.isSafeInteger(qty) || qty < 1 || declaredQty !== qty) invalid("Số lượng combo không hợp lệ.")
    const offer = offers.find((entry: any) => Number(entry.qty) === qty)
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
  return { fee, goodsTotal, optionId, profileId, productIds }
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
    const updates = []
    for (const item of cart.items ?? []) {
      const product: any = productMap.get(variantMap.get(item.variant_id))
      const update = configuredBundleLineUpdate(item, product?.metadata)
      if (update) {
        updates.push(update)
        Object.assign(item, update)
      }
    }
    if (updates.length) await scope.resolve(Modules.CART).updateLineItems(updates)
  }
  return { cart, plan: deriveBundleShippingPlan(cart, products, variants) }
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
