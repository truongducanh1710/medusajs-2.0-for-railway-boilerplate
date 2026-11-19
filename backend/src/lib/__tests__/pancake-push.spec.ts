jest.mock("../constants", () => ({
  PANCAKE_API_BASE: "https://pos.test/api/v1",
  PANCAKE_API_KEY: "k",
  PANCAKE_SHOP_ID: "1",
  PANCAKE_WAREHOUSE_ID: undefined,
}))
jest.mock("../db", () => ({ getPool: () => ({ query: async () => ({ rows: [] }) }) }))

import { pushOrderToPancake } from "../pancake"

const addr = { first_name: "Cao", last_name: "Thị", phone: "0900000000", address_1: "Số 4", city: "Việt Nam" }

function orderWith(metadata: Record<string, any>) {
  return {
    id: "order_1",
    items: [{ title: "Lịch Toán", quantity: 1, unit_price: 149000, variant: { sku: "X" }, metadata: {} }],
    discount_total: 0,
    metadata,
  }
}

async function pushedBody(order: any) {
  const calls: any[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: any) => {
    if (init?.method === "POST") {
      calls.push(JSON.parse(init.body))
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: { id: 1 } }), json: async () => ({ success: true, data: { id: 1 } }) }
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }), text: async () => "{}" }
  })
  await pushOrderToPancake(order, addr).catch(() => {})
  return calls[0]
}

describe("pushOrderToPancake payment amounts", () => {
  it("SePay order with QR discount: POS total = amount paid, COD 0 (#100005)", async () => {
    const body = await pushedBody(orderWith({ payment_method: "sepay", sepay_discount: 10000 }))
    expect(body.prepaid).toBe(139000)
    expect(body.cod).toBe(0)
    expect(body.total_discount).toBe(10000)
    // POS: sum(items) - total_discount + shipping - prepaid = remaining COD
    const posTotal = body.items.reduce((s: number, i: any) => s + i.variation_info.retail_price * i.quantity, 0) - body.total_discount + body.shipping_fee
    expect(posTotal - body.prepaid).toBe(0)
  })

  it("COD order is unchanged: no QR discount", async () => {
    const body = await pushedBody(orderWith({ payment_method: "cod", sepay_discount: 10000 }))
    expect(body.total_discount).toBe(0)
    expect(body.cod).toBe(149000)
    expect(body.prepaid).toBe(0)
  })
})
