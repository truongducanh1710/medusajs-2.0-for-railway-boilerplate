jest.mock("@medusajs/framework/utils", () => {
  class MedusaError extends Error {
    static Types = { INVALID_DATA: "invalid_data", NOT_FOUND: "not_found" }
    type: string
    constructor(type: string, message: string) { super(message); this.type = type }
  }
  return { MedusaError, ContainerRegistrationKeys: { QUERY: "query" }, Modules: { PRODUCT: "product", FULFILLMENT: "fulfillment", CART: "cart" } }
})

import { deriveBundleShippingPlan, assertBundleShippingMethods, storedBundleShippingFee, validateBundleShippingCart, configuredBundleLineUpdate } from "../bundle-shipping"

const products = [{ id: "tray", shipping_profile_id: "tray-profile", metadata: {
  bundle_options: JSON.stringify([{ qty: 1, price: 99000, shippingFee: 30000 }, { qty: 2, price: 229000, shippingFee: 0 }, { qty: 3, price: 299000, shippingFee: 0 }]),
  bundle_shipping_option_ids: JSON.stringify({ "0": "free", "30000": "paid" }),
} }]
const variants = [{ id: "tray-variant", product_id: "tray" }]
const cartFor = (qty: number, price: number, fee: number) => ({ id: "cart", currency_code: "vnd", metadata: { sepay_discount: 0 }, shipping_total: fee,
  items: [{ id: "item", variant_id: "tray-variant", quantity: qty, unit_price: Math.round(price / qty), metadata: { bundle_qty: qty, bundle_price: price }, adjustments: [] }],
  shipping_methods: [{ shipping_option_id: fee ? "paid" : "free", amount: fee, adjustments: [] }],
})

describe("server-authoritative bundle shipping", () => {
  test("configured triple price uses a decimal native price instead of rounding each item", () => {
    const update = configuredBundleLineUpdate(cartFor(3, 299000, 0).items[0], products[0].metadata)!
    expect(update.unit_price * 3).toBeCloseTo(299000, 6)
    expect(update.unit_price).not.toBe(Math.round(299000 / 3))
    expect(update.is_custom_price).toBe(true)
  })
  test("quantity changes recover authoritative price, shipping and gift metadata", () => {
    const item = cartFor(2, 229000, 0).items[0]
    item.quantity = 1
    ;(item.metadata as any).gifts = JSON.stringify([{ name: "Tampered gift" }])
    const update = configuredBundleLineUpdate(item, products[0].metadata)!
    expect(update.unit_price).toBe(99000)
    expect(update.metadata).toMatchObject({ bundle_qty: 1, bundle_price: 99000, bundle_shipping_fee: 30000, gifts: "[]" })
  })
  test("configured price normalization preserves exact server gift names", () => {
    const metadata = { bundle_options: [{ qty: 2, price: 229000, shippingFee: 0, gifts: [{ name: "1 Hộp inox", sku: "HOP", quantity: 1 }, { name: "1 Chổi inox", sku: "CHOI", quantity: 1 }] }] }
    const update = configuredBundleLineUpdate(cartFor(2, 229000, 0).items[0], metadata)!
    expect(JSON.parse(update.metadata.gifts)).toEqual(metadata.bundle_options[0].gifts)
    expect(configuredBundleLineUpdate({ ...cartFor(2, 229000, 0).items[0], ...update }, metadata)).toBeNull()
  })
  test("new normalization never activates legacy products", () => {
    expect(configuredBundleLineUpdate(cartFor(2, 229000, 0).items[0], { bundle_options: [{ qty: 2, price: 229000 }] })).toBeNull()
  })
  test("configured unsupported quantities fail rather than applying an arbitrary client price", () => {
    expect(() => configuredBundleLineUpdate({ ...cartFor(2, 229000, 0).items[0], quantity: 4 }, products[0].metadata)).toThrow(/Số lượng/)
  })
  test.each([[1, 99000, 30000], [2, 229000, 0], [3, 299000, 0]])("offer qty %i keeps exact goods price and shipping", (qty, price, fee) => {
    const cart = cartFor(qty, price, fee)
    const plan = deriveBundleShippingPlan(cart, products, variants)!
    expect(plan.goodsTotal + plan.fee).toBe(price + fee)
    expect(() => assertBundleShippingMethods(cart, plan)).not.toThrow()
  })
  test("line fee and omitted marker cannot override the server fee", () => {
    const cart = cartFor(1, 99000, 30000)
    ;(cart.items[0].metadata as any).bundle_shipping_fee = 0
    expect(deriveBundleShippingPlan(cart, products, variants)?.fee).toBe(30000)
  })
  test("legacy free option cannot complete the paid single offer", () => {
    const cart = cartFor(1, 99000, 0)
    const plan = deriveBundleShippingPlan(cart, products, variants)
    expect(() => assertBundleShippingMethods(cart, plan)).toThrow(/Phí vận chuyển/)
  })
  test("rejects tampered price, quantity and unsettled stored price", () => {
    const cart = cartFor(2, 229000, 0)
    cart.items[0].metadata.bundle_price = 99000
    expect(() => deriveBundleShippingPlan(cart, products, variants)).toThrow(/Giá combo/)
    cart.items[0].metadata.bundle_price = 229000
    cart.items[0].metadata.bundle_qty = 1
    expect(() => deriveBundleShippingPlan(cart, products, variants)).toThrow(/Số lượng/)
    cart.items[0].metadata.bundle_qty = 2
    cart.items[0].unit_price = 99000
    expect(() => deriveBundleShippingPlan(cart, products, variants)).toThrow(/chưa cập nhật/)
  })
  test("rejects additional shipping discount and QR discount", () => {
    const cart = cartFor(1, 99000, 30000)
    const plan = deriveBundleShippingPlan(cart, products, variants)
    cart.metadata.sepay_discount = 1000
    expect(() => assertBundleShippingMethods(cart, plan)).toThrow(/QR/)
    cart.metadata.sepay_discount = 0
    ;(cart.shipping_methods[0].adjustments as any[]).push({ amount: 30000 })
    expect(() => assertBundleShippingMethods(cart, plan)).toThrow(/Phí vận chuyển/)
  })
  test("takes the maximum fee for one parcel of compatible configured lines", () => {
    const cart = cartFor(2, 229000, 30000)
    cart.items.push({ ...cartFor(1, 99000, 30000).items[0], id: "item2" })
    const plan = deriveBundleShippingPlan(cart, products, variants)!
    expect(plan.goodsTotal).toBe(328000)
    expect(plan.fee).toBe(30000)
  })
  test("rejects mixed profiles and legacy items instead of guessing shipping", () => {
    const cart = cartFor(1, 99000, 30000)
    cart.items.push({ ...cart.items[0], id: "item2", variant_id: "legacy-variant" })
    expect(() => deriveBundleShippingPlan(cart, [...products, { id: "legacy", metadata: {} } as any], [...variants, { id: "legacy-variant", product_id: "legacy" }])).toThrow(/riêng/)
    const other = { ...products[0], id: "other", shipping_profile_id: "other-profile" }
    expect(() => deriveBundleShippingPlan(cart, [...products, other], [...variants, { id: "legacy-variant", product_id: "other" }])).toThrow(/khác nhau/)
  })
  test("legacy products retain no shipping policy", () => {
    const cart = cartFor(1, 99000, 0)
    expect(deriveBundleShippingPlan(cart, [{ ...products[0], metadata: {} }], variants)).toBeNull()
    expect(() => assertBundleShippingMethods(cart, null)).not.toThrow()
    expect(storedBundleShippingFee(cart)).toBe(0)
  })
  test("fulfillment uses stored amount rather than a client fee", () => {
    const order = { shipping_total: 30000, items: [{ metadata: { bundle_shipping_fee: 0 } }] }
    expect(storedBundleShippingFee(order)).toBe(30000)
  })
  test("native completion stamps the configured marker and removes a legacy spoof", async () => {
    const cart = cartFor(1, 99000, 30000)
    const updateLineItems = jest.fn()
    const scope = { resolve: (name: string) => ({
      query: { graph: async ({ entity }: { entity: string }) => ({ data: entity === "product" ? products.map((product) => ({ ...product, shipping_profile: { id: product.shipping_profile_id } })) : [cart] }) },
      product: { listProductVariants: async () => variants, listProducts: async () => products },
      fulfillment: { retrieveShippingOption: async () => ({ shipping_profile_id: "tray-profile", price_type: "flat" }) },
      cart: { updateLineItems },
    } as any)[name] }
    await validateBundleShippingCart(scope, cart.id)
    expect(updateLineItems).toHaveBeenCalledWith([expect.objectContaining({ metadata: expect.objectContaining({ bundle_shipping_fee: 30000 }) })])
    ;(cart.items[0].metadata as any).bundle_shipping_fee = 0
    const legacyScope = { resolve: (name: string) => name === "query" ? { graph: async ({ entity }: { entity: string }) => ({ data: entity === "product" ? [{ ...products[0], metadata: {}, shipping_profile: { id: "tray-profile" } }] : [cart] }) } : scope.resolve(name) }
    updateLineItems.mockClear()
    await validateBundleShippingCart(legacyScope, cart.id)
    expect(updateLineItems.mock.calls[0][0][0].metadata).not.toHaveProperty("bundle_shipping_fee")
  })
})
