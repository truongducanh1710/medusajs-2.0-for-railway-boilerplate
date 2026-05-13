import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID, PANCAKE_WAREHOUSE_ID } from './constants'
import { getPancakeProvinceId, getPancakeCommuneId } from './pancake-address'

// Cache Pancake variation map: SKU (display_id) → variation UUID
let variationMapCache: Map<string, string> | null = null
let variationMapCachedAt = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function getPancakeVariationMap(): Promise<Map<string, string>> {
  const now = Date.now()
  if (variationMapCache && now - variationMapCachedAt < CACHE_TTL_MS) {
    return variationMapCache
  }

  const map = new Map<string, string>()
  let page = 1
  const limit = 100

  while (true) {
    const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/products?api_key=${PANCAKE_API_KEY}&page=${page}&limit=${limit}`
    const res = await fetch(url)
    if (!res.ok) break
    const data = await res.json()
    const products: any[] = data.data ?? data.products ?? []
    if (!products.length) break

    for (const product of products) {
      for (const variation of product.variations ?? []) {
        if (variation.display_id && variation.id) {
          map.set(variation.display_id, variation.id)
        }
      }
    }

    if (page >= (data.total_pages ?? 1)) break
    page++
  }

  variationMapCache = map
  variationMapCachedAt = now
  console.info(`[Pancake] Loaded ${map.size} variations into map`)
  return map
}

export async function pushOrderToPancake(order: any, shippingAddress: any) {
  if (!PANCAKE_API_KEY || !PANCAKE_SHOP_ID) {
    console.warn('[Pancake] PANCAKE_API_KEY or PANCAKE_SHOP_ID is not set, skipping push')
    return
  }

  const variationMap = await getPancakeVariationMap()

  const billFullName = [shippingAddress.first_name, shippingAddress.last_name]
    .filter(Boolean)
    .join(' ')

  const items = (order.items || []).map((item: any) => {
    const sku = item.variant?.sku as string | undefined
    const pancakeVariationId = sku ? (variationMap.get(sku) ?? null) : null
    const matched = Boolean(pancakeVariationId)

    console.info(`[Pancake] Item "${item.title}" sku=${sku} → variation_id=${pancakeVariationId ?? 'none (one_time_product)'}`)

    // bundle_qty = số thật khách chọn, bundle_price = tổng giá bundle
    // unit_price trong Medusa là giá 1 SP từ DB — không dùng để tính tổng
    const bundleQty: number = (item.metadata?.bundle_qty as number) || item.quantity
    const bundlePrice: number = (item.metadata?.bundle_price as number) || (item.unit_price * item.quantity)
    const unitPriceForPancake = bundleQty > 0 ? Math.round(bundlePrice / bundleQty) : item.unit_price

    return {
      variation_id: pancakeVariationId,
      quantity: bundleQty,
      is_bonus_product: false,
      is_discount_percent: false,
      is_wholesale: false,
      one_time_product: !matched,
      discount_each_product: 0,
      variation_info: {
        name: item.title,
        retail_price: unitPriceForPancake,
      },
    }
  })

  // Xác định phương thức thanh toán từ metadata
  const paymentMethod = order.metadata?.payment_method as string | undefined
  const isSepay = paymentMethod === 'sepay'

  // Tổng tiền
  const totalPrice = order.summary?.current_order_total ?? order.total ?? 0
  const totalDiscount = order.summary?.discount_total ?? 0

  // Nếu thanh toán SePay → đã trả trước, COD = 0
  // Nếu COD → chưa trả, COD = tổng đơn
  const prepaid = isSepay ? totalPrice : 0
  const cash = 0
  const cod = isSepay ? 0 : totalPrice

  // Ghi chú: kết hợp ghi chú khách + gifts + payment method
  const noteparts: string[] = []
  if (order.metadata?.note) noteparts.push(order.metadata.note as string)
  if (isSepay) noteparts.push('Đã thanh toán SePay')

  // Gifts từ line item metadata — thêm vào ghi chú để sale biết
  const giftLines: string[] = []
  for (const item of order.items || []) {
    try {
      const gifts = JSON.parse((item.metadata?.gifts as string) || '[]')
      for (const g of gifts) {
        if (g.name) giftLines.push(`🎁 ${g.name}`)
      }
    } catch {}
  }
  if (giftLines.length > 0) noteparts.push('Quà tặng kèm:\n' + giftLines.join('\n'))

  const note = noteparts.join('\n').trim()

  // UTM từ order metadata (sẽ được ghi vào khi implement Facebook Pixel)
  const utmSource = order.metadata?.utm_source as string | undefined
  const utmMedium = order.metadata?.utm_medium as string | undefined
  const utmCampaign = order.metadata?.utm_campaign as string | undefined
  const utmContent = order.metadata?.utm_content as string | undefined
  const utmTerm = order.metadata?.utm_term as string | undefined

  // Lookup province_id và commune_id từ tên tỉnh/phường
  const provinceName = order.metadata?.province as string || shippingAddress.city || ''
  const wardName = order.metadata?.ward as string || shippingAddress.province || ''

  const provinceId = getPancakeProvinceId(provinceName)
  console.info(`[Pancake] Address lookup: province="${provinceName}" → ${provinceId}, ward="${wardName}" (not mapped — Pancake uses GHN format)`)

  const payload: Record<string, any> = {
    shop_id: Number(PANCAKE_SHOP_ID),
    bill_full_name: billFullName,
    bill_phone_number: shippingAddress.phone || '',
    note,
    shipping_address: {
      full_name: billFullName,
      phone_number: shippingAddress.phone || '',
      address: shippingAddress.address_1 || '',
      province_id: provinceId,
      district_id: null,
      commune_id: null,
    },
    items,
    is_free_shipping: true,
    received_at_shop: false,
    shipping_fee: 0,
    total_discount: totalDiscount,
    cash,
    prepaid,
    cod,
    status: 0,
  }

  if (PANCAKE_WAREHOUSE_ID) {
    payload.warehouse_id = PANCAKE_WAREHOUSE_ID
  }

  // Tag để nhận diện đơn từ website khi sync ngược lại
  payload.tags = [{ name: "phanviet-web" }]

  // UTM marketing data
  payload.marketing = {
    p_utm_source: utmSource || "phanviet.vn",
    ...(utmMedium && { p_utm_medium: utmMedium }),
    ...(utmCampaign && { p_utm_campaign: utmCampaign }),
    ...(utmContent && { p_utm_content: utmContent }),
    ...(utmTerm && { p_utm_term: utmTerm }),
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
  const pancakeOrderId = result?.id ?? result?.order?.id ?? result?.data?.id ?? 'unknown'
  console.log(`[Pancake] Order pushed successfully, Pancake order ID: ${pancakeOrderId}`)
  console.log(`[Pancake] Response keys: ${Object.keys(result || {}).join(', ')}`)
  return result
}
