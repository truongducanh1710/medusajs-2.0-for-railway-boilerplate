import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID, PANCAKE_WAREHOUSE_ID } from './constants'
import { getPancakeProvinceId, getPancakeCommuneId, detectProvinceFromText } from './pancake-address'
import { getPool } from './db'
import { storedBundleShippingFee, hasBundleShippingLines } from './bundle-shipping'

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

// Map MKT code → Pancake marketer UUID (từ raw data đã verify trong DB)
export const MKT_PANCAKE_UUID: Record<string, string> = {
  ANHNT:   "79c371d0-b20f-41ab-a7d7-f9b43d7d3073",
  KIENLB:  "5587fee3-74e1-4a16-aee9-27097685e2f4",
  LINHMT:  "727ca757-a2b8-42a3-a9d8-b9b70c2a8149",
  NAMDV:   "e1ca9829-695e-40c6-947c-a986fd40b464",
  // Lấy từ raw.marketer của 80 đơn Pancake đã gán ANHTD; khớp pke_mkter trong link Webcake /giamgiasoc
  ANHTD:   "2b727738-e7b0-4be4-8c94-e9ab2efc66ef",
  XUANLT:  "9a01ac6e-7a93-4f19-8740-92b7be47902e",
  DUPD:    "ef25c657-e2f4-4e5c-854e-5b29268da253", // BICHNTN alias — update nếu có UUID riêng
}

// Extract MKT code từ utm_campaign: "{PRODUCT}_{DD/M}_{MKTCODE}_..." → "MKTCODE"
// Format: PHVVN026CV_12/6_ANHTD_CHAO VANG → parts[2] = "ANHTD"
// Date token DD/M hoặc D/M phải có mặt ở parts[1]
export function extractMktCode(campaign: string | undefined): string | undefined {
  if (!campaign) return undefined
  const parts = campaign.split("_")
  // Tìm index của date token (DD/M hoặc D/M)
  const dateIdx = parts.findIndex(p => /^\d{1,2}\/\d{1,2}$/.test(p))
  if (dateIdx < 0) return undefined
  return parts[dateIdx + 1]?.trim() || undefined
}

// MKT codes whose UUID mapping is not verified — never auto-reassign these.
// XUANLT has 2 Pancake UUIDs in use; DUPD is an alias.
const MKT_AUTOFIX_SKIP = new Set(["XUANLT", "DUPD"])

type HandoverRule = { from_code: string; to_code: string; effective_from: string; effective_to: string | null }

let handoverCache: HandoverRule[] | null = null
let handoverCachedAt = 0
const HANDOVER_TTL_MS = 5 * 60 * 1000

async function loadHandoverRules(): Promise<HandoverRule[]> {
  const now = Date.now()
  if (handoverCache && now - handoverCachedAt < HANDOVER_TTL_MS) return handoverCache
  try {
    const { rows } = await getPool().query(
      `SELECT from_code, to_code, effective_from::text, effective_to::text FROM mkt_handover WHERE deleted_at IS NULL`
    )
    handoverCache = rows
  } catch {
    handoverCache = [] // bảng chưa tồn tại
  }
  handoverCachedAt = now
  return handoverCache!
}

// Pancake inserted_at is UTC without a zone suffix — reports use the same convention
// (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh').
function vnDateOf(insertedAt: string | undefined): string {
  const s = insertedAt ? (/[zZ]|[+-]\d{2}:?\d{2}$/.test(insertedAt) ? insertedAt : insertedAt + "Z") : undefined
  const d = s ? new Date(s) : new Date()
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(isNaN(d.getTime()) ? new Date() : d)
}

/**
 * Apply mkt_handover rules (same table + semantics as the MKT reports): a camp still
 * named after the old MKT belongs to the new MKT from effective_from (VN date).
 * Follows chains (A→B→C) with a hop limit to guard against cycles.
 */
export async function resolveHandoverCode(code: string, vnDate: string): Promise<string> {
  const rules = await loadHandoverRules()
  let current = code
  for (let hop = 0; hop < 5; hop++) {
    const rule = rules.find(r =>
      r.from_code === current &&
      vnDate >= r.effective_from &&
      (!r.effective_to || vnDate <= r.effective_to)
    )
    if (!rule || rule.to_code === current) break
    current = rule.to_code
  }
  return current
}

/**
 * Webcake landing pages carry a hidden "mkt" field that sets the Pancake marketer.
 * When one MKT runs ads to another MKT's landing (e.g. ANHTD's POSTWIN camp using
 * ANHNT's /kedunggiavianhnt post), orders get credited to the landing owner.
 * The campaign name in p_utm_source is the real owner — reassign to it.
 * Returns the MKT code it switched to, or undefined if nothing changed.
 */
export async function fixMarketerFromUtm(
  rawOrder: any,
  shop: { shopId: string | number; apiKey: string }
): Promise<string | undefined> {
  const campCode = extractMktCode(rawOrder?.p_utm_source) || extractMktCode(rawOrder?.p_utm_campaign)
  if (!campCode) return undefined
  // Camp ANHNT handed over to KIENLB → order belongs to KIENLB, not the name in the camp.
  const code = await resolveHandoverCode(campCode, vnDateOf(rawOrder?.inserted_at))
  if (MKT_AUTOFIX_SKIP.has(code)) return undefined
  const uuid = MKT_PANCAKE_UUID[code]
  if (!uuid) return undefined

  const norm = (s: any) => String(s ?? "").replace(/\s+/g, "").toUpperCase()
  const currentId = rawOrder?.marketer?.id ?? rawOrder?.pke_mkter
  if (currentId === uuid || norm(rawOrder?.marketer?.name) === code) return undefined

  const url = `${PANCAKE_API_BASE}/shops/${shop.shopId}/orders/${rawOrder.id}?api_key=${shop.apiKey}`
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pke_mkter: uuid }),
  })
  if (!res.ok) throw new Error(`PUT marketer ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return code
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

  const configuredShipping = hasBundleShippingLines(order)
  const items = (order.items || []).map((item: any) => {
    const sku = item.variant?.sku as string | undefined
    const pancakeVariationId = sku ? (variationMap.get(sku) ?? null) : null
    const matched = Boolean(pancakeVariationId)

    console.info(`[Pancake] Item "${item.title}" sku=${sku} → variation_id=${pancakeVariationId ?? 'none (one_time_product)'}`)

    const bundleQty: number = (item.metadata?.bundle_qty as number) || item.quantity
    // Ưu tiên bundle_price MKT set trên landing page, fallback unit_price Medusa
    const bundlePrice: number = (item.metadata?.bundle_price as number) || (item.unit_price * bundleQty)
    const unitPriceForPancake: number = bundleQty > 0
      ? (configuredShipping ? bundlePrice / bundleQty : Math.round(bundlePrice / bundleQty))
      : (item.unit_price || 0)

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
  const totalDiscount = configuredShipping ? 0 : (roundedDiscount > 0 ? roundedDiscount : rawDiscount)
  const sepayDiscount = !configuredShipping && isSepay ? ((order.metadata?.sepay_discount as number) ?? 0) : 0
  const shippingFee = storedBundleShippingFee(order)
  const totalPrice = bundleTotal > 0
    ? bundleTotal - totalDiscount - sepayDiscount + shippingFee
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

  let mktCode: string | undefined = extractMktCode(utmCampaign) || extractMktCode(utmSource)

  // Không có UTM → đoán nguồn từ mã click (ttclid/gclid/fbclid) hoặc host trang giới thiệu
  // do storefront lưu. Ghi vào ghi chú Nội bộ + p_utm_medium; p_utm_source GIỮ "phanviet.vn"
  // vì pancake-sync dựa vào giá trị đó để nhận ra đơn website.
  const inferredSource = utmSource ? null : inferWebSource(order.metadata || {})

  // Ghi chú: kết hợp ghi chú khách + gifts + UTM (giống format Webcake để sale xem nhanh)
  const noteparts: string[] = ["[phanviet.vn]"]
  if (order.metadata?.note) noteparts.push(order.metadata.note as string)
  if (configuredShipping) noteparts.push(shippingFee > 0 ? `Phí vận chuyển: ${shippingFee.toLocaleString("vi-VN")}đ` : "Miễn phí vận chuyển")
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
        if (g.name) giftLines.push(`🎁 ${g.name}${configuredShipping && g.sku ? ` [${g.sku}]` : ""}`)
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
  if (inferredSource) noteparts.push(`nguồn (không UTM): ${inferredSource.label}`)

  const note = noteparts.join('\n').trim()

  // Lookup province_id và commune_id từ tên tỉnh/phường
  const provinceName = order.metadata?.province as string || shippingAddress.city || ''
  const wardName = order.metadata?.ward as string || shippingAddress.province || ''

  // Form web gộp cả địa chỉ vào address_1 và ghi "Việt Nam" vào city, nên tên tỉnh
  // thường không tra được — khi đó đoán tỉnh từ chính chuỗi địa chỉ.
  const provinceId = getPancakeProvinceId(provinceName)
    ?? detectProvinceFromText(`${shippingAddress.address_1 || ''} ${shippingAddress.address_2 || ''}`)
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
    is_free_shipping: shippingFee === 0,
    received_at_shop: false,
    shipping_fee: shippingFee,
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
  else if (inferredSource) payload.p_utm_medium = inferredSource.medium
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
  const guiDon = async (body: Record<string, any>) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    return { ok: response.ok, status: response.status, text }
  }

  let lan = await guiDon(payload)
  let hetHang = false

  // Pancake chặn đơn khi sản phẩm có mã tồn kho mà hết hàng:
  //   422 "PHVVN026_CV - PHVVN027_CV có số lượng hàng sắp về không đủ!"
  // Đơn Webcake vẫn vào được (trạng thái Chờ hàng) nhưng đơn web thì bị từ chối hẳn —
  // 27/09 mất 4 đơn web vì lỗi này, không ai biết vì lỗi chỉ nằm trong log.
  // Đẩy lại với sản phẩm dạng thủ công (không gắn variation_id → Pancake không kiểm
  // tồn). Cách này đã chạy được lúc hết hàng: route checkout-abandon dùng đúng kiểu
  // item này và tạo đơn nháp thành công 27/09 11:57 khi Chảo vàng đang hết.
  // Đánh đổi: đơn không trừ tồn kho tự động → gắn tag + ghi chú để kho gán lại SP.
  if (!lan.ok && lan.status === 422 && /không đủ|hết hàng|tồn kho|số lượng/i.test(lan.text)) {
    hetHang = true
    console.warn(`[Pancake] Hết hàng — đẩy lại với sản phẩm thủ công. Lỗi gốc: ${lan.text.slice(0, 200)}`)
    const skuCuaItem = (order.items || []).map((it: any) => it.variant?.sku).filter(Boolean)
    const fallback = {
      ...payload,
      items: payload.items.map((it: any, i: number) => ({
        ...it,
        variation_id: null,
        one_time_product: true,
        variation_info: {
          ...it.variation_info,
          name: `${it.variation_info?.name || 'Sản phẩm'}${skuCuaItem[i] ? ` [${skuCuaItem[i]}]` : ''}`,
        },
      })),
      note: `[HẾT HÀNG LÚC ĐẶT — kho cần gán lại sản phẩm: ${skuCuaItem.join(', ') || 'xem tên SP'}]\n${payload.note || ''}`.trim(),
      tags: [...(payload.tags || []), { name: 'Web hết hàng - cần gán SP' }],
    }
    lan = await guiDon(fallback)
  }

  if (!lan.ok) {
    throw new Error(`Pancake API error ${lan.status}: ${lan.text}`)
  }

  const result = JSON.parse(lan.text || '{}')
  const pancakeOrderId = result?.id ?? result?.order?.id ?? result?.data?.id ?? 'unknown'
  console.log(`[Pancake] Order pushed successfully${hetHang ? ' (dạng hết hàng)' : ''}, Pancake order ID: ${pancakeOrderId}`)
  if (hetHang) result._het_hang = true
  return result
}

/**
 * Đoán nguồn đơn website khi không có UTM, từ dấu vết storefront lưu vào metadata đơn:
 * mã click (ttclid TikTok, gclid Google, fbclid Facebook) ưu tiên hơn host trang giới thiệu.
 */
export function inferWebSource(md: Record<string, any>): { medium: string; label: string } {
  if (md.ttclid) return { medium: "tiktok", label: "TikTok (có ttclid)" }
  if (md.gclid) return { medium: "google-ads", label: "Google Ads (có gclid)" }
  if (md.fbclid) return { medium: "facebook", label: "Facebook (có fbclid, không UTM)" }
  const ref = String(md.ref || "").toLowerCase()
  if (!ref) return { medium: "direct", label: "vào thẳng / không rõ (không có trang giới thiệu)" }
  const map: [RegExp, string, string][] = [
    [/google\./, "google", "Google"],
    [/tiktok\.com|byteoversea|musical/, "tiktok", "TikTok"],
    [/facebook\.com|fb\.com|fb\.me|messenger\.com|instagram\.com/, "facebook", "Facebook/Instagram"],
    [/zalo\.me|zaloapp\.com|zalo\./, "zalo", "Zalo"],
    [/youtube\.com|youtu\.be/, "youtube", "YouTube"],
    [/coccoc\.com|bing\.com|yahoo\./, "search", "công cụ tìm kiếm khác"],
  ]
  for (const [re, medium, name] of map) if (re.test(ref)) return { medium, label: `${name} (từ ${ref})` }
  return { medium: "referral", label: `trang khác (${ref})` }
}

