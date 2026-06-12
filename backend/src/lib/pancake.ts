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

    const bundleQty: number = (item.metadata?.bundle_qty as number) || item.quantity
    // Ưu tiên bundle_price MKT set trên landing page, fallback unit_price Medusa
    const bundlePrice: number = (item.metadata?.bundle_price as number) || (item.unit_price * bundleQty)
    const unitPriceForPancake: number = bundleQty > 0 ? Math.round(bundlePrice / bundleQty) : (item.unit_price || 0)

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

  // Tổng tiền: ưu tiên tổng bundle_price từ items (giá MKT thật) trừ discount promotion
  // order.total là giá Medusa tính từ unit_price (sai với bundle) → không dùng trực tiếp
  const bundleTotal = (order.items || []).reduce((sum: number, item: any) => {
    const bp = (item.metadata?.bundle_price as number) || 0
    const bq = (item.metadata?.bundle_qty as number) || item.quantity || 1
    return sum + (bp > 0 ? bp : (item.unit_price || 0) * bq)
  }, 0)
  // Ưu tiên promo_discount_rounded (đã làm tròn lên 1.000đ, khớp với số khách thấy ở checkout)
  // Fallback về order.discount_total (Medusa tính, số lẻ) nếu metadata không có
  const rawDiscount = order.discount_total ?? order.summary?.discount_total ?? 0
  const roundedDiscount = Number(order.metadata?.promo_discount_rounded ?? 0)
  const totalDiscount = roundedDiscount > 0 ? roundedDiscount : rawDiscount
  const sepayDiscount = isSepay ? ((order.metadata?.sepay_discount as number) ?? 0) : 0
  const totalPrice = bundleTotal > 0
    ? bundleTotal - totalDiscount - sepayDiscount
    : (order.summary?.current_order_total ?? order.total ?? 0)

  // Nếu thanh toán SePay → đã trả trước, COD = 0
  // Nếu COD → chưa trả, COD = tổng đơn
  const prepaid = isSepay ? totalPrice : 0
  const cash = 0
  const cod = isSepay ? 0 : totalPrice

  // UTM từ order metadata (set bởi storefront qua cookie pvw_utm)
  const utmSource = order.metadata?.utm_source as string | undefined
  const utmMedium = order.metadata?.utm_medium as string | undefined
  const utmCampaign = order.metadata?.utm_campaign as string | undefined
  const utmContent = order.metadata?.utm_content as string | undefined
  const utmTerm = order.metadata?.utm_term as string | undefined

  // Map MKT code → Pancake marketer UUID (từ raw data đã verify trong DB)
  const MKT_PANCAKE_UUID: Record<string, string> = {
    ANHNT:   "79c371d0-b20f-41ab-a7d7-f9b43d7d3073",
    KIENLB:  "5587fee3-74e1-4a16-aee9-27097685e2f4",
    LINHMT:  "727ca757-a2b8-42a3-a9d8-b9b70c2a8149",
    NAMDV:   "e1ca9829-695e-40c6-947c-a986fd40b464",
    XUANLT:  "9a01ac6e-7a93-4f19-8740-92b7be47902e",
    DUPD:    "ef25c657-e2f4-4e5c-854e-5b29268da253", // BICHNTN alias — update nếu có UUID riêng
  }

  // Extract MKT code từ utm_campaign: "{PRODUCT}_{DD/M}_{MKTCODE}_..." → "MKTCODE"
  // Format: PHVVN026CV_12/6_ANHTD_CHAO VANG → parts[2] = "ANHTD"
  // Date token DD/M hoặc D/M phải có mặt ở parts[1]
  function extractMktCode(campaign: string | undefined): string | undefined {
    if (!campaign) return undefined
    const parts = campaign.split("_")
    // Tìm index của date token (DD/M hoặc D/M)
    const dateIdx = parts.findIndex(p => /^\d{1,2}\/\d{1,2}$/.test(p))
    if (dateIdx < 0) return undefined
    return parts[dateIdx + 1]?.trim() || undefined
  }

  let mktCode: string | undefined = extractMktCode(utmCampaign) || extractMktCode(utmSource)

  // Ghi chú: kết hợp ghi chú khách + gifts + UTM (giống format Webcake để sale xem nhanh)
  const noteparts: string[] = ["[phanviet.vn]"]
  if (order.metadata?.note) noteparts.push(order.metadata.note as string)
  if (isSepay) {
    const fmt = (n: number) => n.toLocaleString('vi-VN') + 'đ'
    const parts = [`Giá SP: ${fmt(bundleTotal)}`]
    if (totalDiscount > 0) parts.push(`Mã giảm: -${fmt(totalDiscount)}`)
    if (sepayDiscount > 0) parts.push(`Giảm QR: -${fmt(sepayDiscount)}`)
    parts.push(`→ Đã CK: ${fmt(totalPrice)}`)
    noteparts.push('✅ Đã thanh toán SePay\n' + parts.join(' | '))
  }

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

  // UTM info cho sale/CSKH thấy nhanh trong Tin nội bộ (giống Webcake)
  if (mktCode) noteparts.push(`mkt: ${mktCode}`)
  if (utmSource) noteparts.push(`camp: ${utmSource}`)
  if (utmCampaign && utmCampaign !== utmSource) noteparts.push(`utm_campaign: ${utmCampaign}`)
  if (utmMedium) noteparts.push(`utm_medium: ${utmMedium}`)
  if (utmContent) noteparts.push(`utm_content: ${utmContent}`)

  const note = noteparts.join('\n').trim()

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

  // UTM marketing data — Pancake nhận UTM ở root payload, không phải lồng trong "marketing"
  payload.p_utm_source = utmSource || "phanviet.vn"
  if (utmMedium) payload.p_utm_medium = utmMedium
  if (utmCampaign) payload.p_utm_campaign = utmCampaign
  if (utmContent) payload.p_utm_content = utmContent
  if (utmTerm) payload.p_utm_term = utmTerm

  // Gán marketer theo Pancake UUID — field "pke_mkter" (verify từ histories của đơn thật)
  const mktUuid = mktCode ? MKT_PANCAKE_UUID[mktCode] : undefined
  if (mktUuid) {
    payload.pke_mkter = mktUuid
    console.info(`[Pancake] Marketer assigned: ${mktCode} → ${mktUuid}`)
  } else if (mktCode) {
    console.warn(`[Pancake] MKT code "${mktCode}" not found in UUID map — marketer not assigned`)
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
