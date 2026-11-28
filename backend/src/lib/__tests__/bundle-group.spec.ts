jest.mock("@medusajs/framework/utils", () => {
  class MedusaError extends Error {
    static Types = { INVALID_DATA: "invalid_data", NOT_FOUND: "not_found" }
    type: string
    constructor(type: string, message: string) { super(message); this.type = type }
  }
  return { MedusaError, ContainerRegistrationKeys: { QUERY: "query" }, Modules: { PRODUCT: "product", FULFILLMENT: "fulfillment", CART: "cart" } }
})

import { groupGifts, groupLineUpdates, GROUPS } from "../bundle-group"
import { deriveBundleShippingPlan, assertBundleShippingMethods } from "../bundle-shipping"

const optionIds = JSON.stringify({ "0": "ice-free", "20000": "ice-paid" })
const meta = (price: number) => ({ bundle_group: "icegel", group_unit_price: price, bundle_shipping_option_ids: optionIds })
const products = [
  { id: "nose", shipping_profile_id: "ice", metadata: meta(118000) },
  { id: "eye", shipping_profile_id: "ice", metadata: meta(168000) },
  { id: "tray", shipping_profile_id: "tray-profile", metadata: { bundle_options: JSON.stringify([{ qty: 1, price: 99000, shippingFee: 30000 }]), bundle_shipping_option_ids: JSON.stringify({ "30000": "paid" }) } },
]
const variants = [{ id: "v-nose", product_id: "nose" }, { id: "v-eye", product_id: "eye" }, { id: "v-tray", product_id: "tray" }]
const metaOf = (variantId: string) => products.find((p) => p.id === variants.find((v) => v.id === variantId)!.product_id)!.metadata

const normalizedCart = (lines: [string, number][], picks: string[] = []) => {
  const items = lines.map(([variantId, qty], i) => ({ id: `li_${i}`, variant_id: variantId, quantity: qty, unit_price: 1, metadata: { gift_picks: picks } as any, adjustments: [] }))
  for (const update of groupLineUpdates(items.map((item) => ({ item, productMetadata: metaOf(item.variant_id) })))) {
    Object.assign(items.find((item) => item.id === update.id)!, update)
  }
  return items
}
const cartWith = (items: any[], fee: number) => ({ id: "cart", currency_code: "vnd", metadata: { sepay_discount: 0 }, shipping_total: fee, items,
  shipping_methods: [{ shipping_option_id: fee ? "ice-paid" : "ice-free", amount: fee, adjustments: [] }] })

describe("ICEgel cross-product box tiers", () => {
  test.each([
    [[["v-nose", 1]], 20000, 0],
    [[["v-nose", 1], ["v-eye", 1]], 20000, 2],
    [[["v-nose", 2], ["v-eye", 1]], 0, 4],
    [[["v-eye", 4]], 0, 6],
    [[["v-eye", 7]], 0, 6],
  ] as [[string, number][], number, number][])("%j → fee %i, %i gift patches", (lines, fee, patches) => {
    const items = normalizedCart(lines)
    const plan = deriveBundleShippingPlan(cartWith(items, fee), products, variants)!
    expect(plan.fee).toBe(fee)
    expect(plan.optionId).toBe(fee ? "ice-paid" : "ice-free")
    expect(plan.goodsTotal).toBe(lines.reduce((sum, [v, q]) => sum + q * metaOf(v).group_unit_price, 0))
    expect(() => assertBundleShippingMethods(cartWith(items, fee), plan)).not.toThrow()
    const gifts = JSON.parse(items[0].metadata.gifts)
    expect(gifts.reduce((sum: number, g: any) => sum + g.quantity, 0)).toBe(patches)
    items.slice(1).forEach((item) => expect(item.metadata.gifts).toBe("[]"))
  })

  test("client-tampered price is rejected", () => {
    const items = normalizedCart([["v-nose", 3]])
    items[0].unit_price = 1000
    expect(() => deriveBundleShippingPlan(cartWith(items, 0), products, variants)).toThrow()
  })

  test("free shipping claimed below 3 boxes cannot pass", () => {
    const items = normalizedCart([["v-nose", 2]])
    const plan = deriveBundleShippingPlan(cartWith(items, 0), products, variants)!
    expect(plan.fee).toBe(20000)
    expect(() => assertBundleShippingMethods(cartWith(items, 0), plan)).toThrow()
  })

  test("ICEgel cannot share a parcel with another shipping profile", () => {
    const items = [...normalizedCart([["v-nose", 1]]), { id: "li_t", variant_id: "v-tray", quantity: 1, unit_price: 99000, metadata: { bundle_qty: 1, bundle_price: 99000 }, adjustments: [] }]
    expect(() => deriveBundleShippingPlan(cartWith(items, 30000), products, variants)).toThrow(/cách giao hàng/)
  })

  test("over the box cap is rejected", () => {
    const items = normalizedCart([["v-nose", 31]])
    expect(() => deriveBundleShippingPlan(cartWith(items, 0), products, variants)).toThrow(/tối đa/)
  })

  test("gift picks are honored, unknown picks fall back to defaults, same types merge", () => {
    const g = GROUPS.icegel
  // ICEgel dropped the Hanoi rate on 28/11; the detection is still tested on a group that has one
  const hn = { ...g, shipping: { localFee: 16000, localProvinces: ["ha noi"], newCustomerFree: true } }
    expect(groupGifts(g, 4, ["mat-na-mat", "mat-na-mat", "hack"])).toEqual([
      expect.objectContaining({ key: "mat-na-mat", quantity: 4 }),
      expect.objectContaining({ key: g.giftChoices[2].key, quantity: 2 }),
    ])
    expect(groupGifts(g, 1, ["mat-na-mat"])).toEqual([])
  })

  test("normalization is idempotent", () => {
    const items = normalizedCart([["v-nose", 2], ["v-eye", 1]], ["thai-duong"])
    expect(groupLineUpdates(items.map((item) => ({ item, productMetadata: metaOf(item.variant_id) })))).toEqual([])
  })
})

describe("groupShippingQuote (28/11 address-based fee)", () => {
  const { GROUPS, groupShippingQuote, normalizeProvince, phoneKey } = require("../bundle-group")
  const g = GROUPS.icegel
  // ICEgel dropped the Hanoi rate on 28/11; the detection is still tested on a group that has one
  const hn = { ...g, shipping: { localFee: 16000, localProvinces: ["ha noi"], newCustomerFree: true } }
  it("free from 3 boxes regardless of address", () => {
    expect(groupShippingQuote(g, 3, { province: "Tỉnh Nghệ An" })).toEqual({ fee: 0, reason: "tier_free" })
  })
  it("new customer ships free on 1 box", () => {
    expect(groupShippingQuote(g, 1, { province: "Tỉnh Nghệ An", isNewCustomer: true })).toEqual({ fee: 0, reason: "new_customer" })
  })
  it("ICEgel charges Hà Nội the default 20k", () => {
    expect(groupShippingQuote(g, 2, { province: "Thành phố Hà Nội" })).toEqual({ fee: 20000, reason: "standard" })
  })
  it("Hà Nội pays the local fee", () => {
    expect(groupShippingQuote(hn, 2, { province: "Thành phố Hà Nội" })).toEqual({ fee: 16000, reason: "local" })
    expect(normalizeProvince("Thành phố Hà Nội")).toBe("ha noi")
  })
  it("finds Hanoi in free-text addresses", () => {
    expect(groupShippingQuote(hn, 1, { province: "12 ngõ 5 Cầu Giấy, HN" }).reason).toBe("local")
    expect(groupShippingQuote(hn, 1, { province: "số 3 Trần Duy Hưng, Trung Hòa, Hanoi" }).reason).toBe("local")
    expect(groupShippingQuote(hn, 1, { province: "88 Xa lộ Hà Nội, Thủ Đức, TP HCM" }).reason).toBe("standard")
    expect(groupShippingQuote(hn, 1, { province: "Thôn Hà, xã Nội Duệ, Bắc Ninh" }).reason).toBe("standard")
  })
  it("other provinces pay the tier fee", () => {
    expect(groupShippingQuote(g, 1, { province: "Thành phố Hồ Chí Minh" })).toEqual({ fee: 20000, reason: "standard" })
  })
  it("phone keys match across formats", () => {
    expect(phoneKey("0912 345 678")).toBe(phoneKey("+84912345678"))
  })
})
