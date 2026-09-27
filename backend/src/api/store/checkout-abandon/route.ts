import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID, PANCAKE_WAREHOUSE_ID } from "../../../lib/constants"
import { getPancakeProvinceId, detectProvinceFromText } from "../../../lib/pancake-address"
import { MKT_PANCAKE_UUID, extractMktCode } from "../../../lib/pancake"

// Chống bắn trùng: mỗi cartId/phone chỉ tạo 1 đơn nháp trong cửa sổ thời gian.
// In-memory (per-instance) — đủ chặn các beacon liên tiếp từ cùng 1 client.
const recentDrafts = new Map<string, number>()
const DEDUPE_WINDOW_MS = 30 * 60 * 1000 // 30 phút

function isDuplicate(key: string): boolean {
  const now = Date.now()
  // Dọn entry hết hạn
  for (const [k, t] of recentDrafts) {
    if (now - t > DEDUPE_WINDOW_MS) recentDrafts.delete(k)
  }
  const last = recentDrafts.get(key)
  if (last && now - last < DEDUPE_WINDOW_MS) return true
  recentDrafts.set(key, now)
  return false
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { name, phone, street, province, ward, note, items, cartId,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body as any

  if (!phone || !/^(0|\+84)[0-9]{8,9}$/.test(String(phone).replace(/\s/g, ""))) {
    return res.status(400).json({ error: "invalid phone" })
  }

  if (!PANCAKE_API_KEY || !PANCAKE_SHOP_ID) {
    return res.status(200).json({ ok: false, reason: "pancake not configured" })
  }

  // Dedupe theo cartId (ưu tiên) hoặc phone nếu không có cartId
  const dedupeKey = cartId || `phone:${String(phone).replace(/\s/g, "")}`
  if (isDuplicate(dedupeKey)) {
    return res.status(200).json({ ok: true, deduped: true })
  }

  try {
    const pancakeItems = (items || []).map((item: any) => ({
      variation_id: null,
      quantity: item.bundle_qty || item.quantity || 1,
      is_bonus_product: false,
      is_discount_percent: false,
      is_wholesale: false,
      one_time_product: true,
      discount_each_product: 0,
      variation_info: {
        name: item.title || "Sản phẩm",
        retail_price: item.bundle_price || item.unit_price || 0,
      },
    }))

    const totalPrice = (items || []).reduce((sum: number, item: any) => {
      return sum + (item.bundle_price || (item.unit_price * (item.bundle_qty || item.quantity || 1)) || 0)
    }, 0)

    const provinceId = getPancakeProvinceId(province || "") ?? detectProvinceFromText(street || "")

    const noteParts = ["[ĐƠN NHÁP - phanviet.vn]", "[Khách điền form nhưng chưa bấm đặt hàng]"]
    if (note) noteParts.push(note)
    if (ward) noteParts.push(`Phường/Xã: ${ward}`)

    const payload: Record<string, any> = {
      shop_id: Number(PANCAKE_SHOP_ID),
      bill_full_name: name || "",
      bill_phone_number: phone,
      note: noteParts.join("\n"),
      shipping_address: {
        full_name: name || "",
        phone_number: phone,
        address: street || "",
        province_id: provinceId,
        district_id: null,
        commune_id: null,
      },
      items: pancakeItems.length ? pancakeItems : [{
        variation_id: null,
        quantity: 1,
        is_bonus_product: false,
        is_discount_percent: false,
        is_wholesale: false,
        one_time_product: true,
        discount_each_product: 0,
        variation_info: { name: "Sản phẩm chưa xác định", retail_price: 0 },
      }],
      is_free_shipping: true,
      received_at_shop: false,
      shipping_fee: 0,
      total_discount: 0,
      cash: 0,
      prepaid: 0,
      cod: totalPrice,
      status: 0,
      tags: [{ name: "Đơn nháp" }, { name: "phanviet-web" }],
      // Giữ p_utm_source = "checkout-abandon" để vẫn nhận ra đơn nháp.
      // Trước 27/09 đơn nháp CHỈ có trường này — mất mã camp/video, không ghép được
      // về camp (vd đơn 90684 từ camp Chảo vàng Ads327). Giờ mang theo UTM từ cookie.
      p_utm_source: "checkout-abandon",
      ...(utm_campaign ? { p_utm_campaign: String(utm_campaign) } : {}),
      ...(utm_content ? { p_utm_content: String(utm_content) } : {}),
      ...(utm_medium ? { p_utm_medium: String(utm_medium) } : {}),
      ...(utm_term ? { p_utm_term: String(utm_term) } : {}),
    }
    if (utm_source) payload.note = `${payload.note}\ncamp: ${utm_source}`
    const mktCode = extractMktCode(utm_campaign) || extractMktCode(utm_source)
    if (mktCode && MKT_PANCAKE_UUID[mktCode]) payload.pke_mkter = MKT_PANCAKE_UUID[mktCode]

    if (PANCAKE_WAREHOUSE_ID) payload.warehouse_id = PANCAKE_WAREHOUSE_ID

    const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/orders?api_key=${PANCAKE_API_KEY}`
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const text = await response.text()
      console.warn(`[checkout-abandon] Pancake error ${response.status}: ${text}`)
      recentDrafts.delete(dedupeKey) // cho phép thử lại lần sau
      return res.status(200).json({ ok: false, reason: "pancake_error" })
    }

    const result = await response.json()
    const pancakeId = result?.id ?? result?.order?.id ?? result?.data?.id ?? "unknown"
    console.info(`[checkout-abandon] Draft order created: phone=${phone} pancake_id=${pancakeId} cart=${cartId}`)

    return res.status(200).json({ ok: true, pancake_id: pancakeId })
  } catch (err: any) {
    console.error("[checkout-abandon] Error:", err?.message)
    recentDrafts.delete(dedupeKey) // cho phép thử lại lần sau
    return res.status(200).json({ ok: false, reason: err?.message })
  }
}
