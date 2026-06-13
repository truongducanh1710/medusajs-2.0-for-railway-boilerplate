import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID, PANCAKE_WAREHOUSE_ID } from "../../../lib/constants"
import { getPancakeProvinceId } from "../../../lib/pancake-address"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { name, phone, street, province, ward, note, items, cartId } = req.body as any

  if (!phone || !/^(0|\+84)[0-9]{8,9}$/.test(String(phone).replace(/\s/g, ""))) {
    return res.status(400).json({ error: "invalid phone" })
  }

  if (!PANCAKE_API_KEY || !PANCAKE_SHOP_ID) {
    return res.status(200).json({ ok: false, reason: "pancake not configured" })
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

    const provinceId = getPancakeProvinceId(province || "")

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
      p_utm_source: "checkout-abandon",
    }

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
      return res.status(200).json({ ok: false, reason: "pancake_error" })
    }

    const result = await response.json()
    const pancakeId = result?.id ?? result?.order?.id ?? result?.data?.id ?? "unknown"
    console.info(`[checkout-abandon] Draft order created: phone=${phone} pancake_id=${pancakeId} cart=${cartId}`)

    return res.status(200).json({ ok: true, pancake_id: pancakeId })
  } catch (err: any) {
    console.error("[checkout-abandon] Error:", err?.message)
    return res.status(200).json({ ok: false, reason: err?.message })
  }
}
