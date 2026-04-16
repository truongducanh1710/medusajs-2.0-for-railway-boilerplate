import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID, PANCAKE_WAREHOUSE_ID } from './constants'

export async function pushOrderToPancake(order: any, shippingAddress: any) {
  if (!PANCAKE_API_KEY || !PANCAKE_SHOP_ID) {
    console.warn('[Pancake] PANCAKE_API_KEY or PANCAKE_SHOP_ID is not set, skipping push')
    return
  }

  const billFullName = [shippingAddress.first_name, shippingAddress.last_name]
    .filter(Boolean)
    .join(' ')

  const items = (order.items || []).map((item: any) => ({
    variation_id: item.variant?.sku || item.variant_id,
    quantity: item.quantity,
    is_bonus_product: false,
    is_discount_percent: false,
    is_wholesale: false,
    one_time_product: false,
    discount_each_product: 0,
    variation_info: {
      name: item.title,
      retail_price: item.unit_price,
    },
  }))

  const payload: Record<string, any> = {
    shop_id: Number(PANCAKE_SHOP_ID),
    bill_full_name: billFullName,
    bill_phone_number: shippingAddress.phone || '',
    note: order.metadata?.note || '',
    shipping_address: {
      full_name: billFullName,
      phone_number: shippingAddress.phone || '',
      address: shippingAddress.address_1 || '',
      province_id: null,
      district_id: null,
      commune_id: null,
      country_code: shippingAddress.country_code || null,
    },
    items,
    is_free_shipping: false,
    received_at_shop: false,
    shipping_fee: 0,
    total_discount: 0,
    cash: 0,
    status: 0,
  }

  if (PANCAKE_WAREHOUSE_ID) {
    payload.warehouse_id = PANCAKE_WAREHOUSE_ID
  }

  const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/orders?api_key=${PANCAKE_API_KEY}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Pancake API error ${response.status}: ${text}`)
  }

  const result = await response.json()
  console.log(`[Pancake] Order pushed successfully, Pancake order ID: ${result?.id || 'unknown'}`)
  return result
}
