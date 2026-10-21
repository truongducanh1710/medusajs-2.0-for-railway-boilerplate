import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { pos, parseLandingPackage } from "../../../../../lib/sale-queue"

/**
 * GET /admin/pancake-sync/call-board/order?id=95491
 * Bản đơn MỚI NHẤT từ POS cho thẻ sửa đơn — không dùng DB vì DB có thể trễ 2 phút,
 * sửa trên bản cũ dễ ghi đè thay đổi của người khác.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const id = String((req.query as any).id ?? "").replace(/\D/g, "")
  if (!id) return res.status(400).json({ error: "Thiếu id đơn" })
  try {
    const o = (await pos("GET", `/orders/${id}`))?.data
    if (!o) return res.status(404).json({ error: "Không thấy đơn trên POS" })
    const uuid = (() => { try { return new URL(o.order_link).searchParams.get("order_id") } catch { return null } })()
    const notes = (o.customer?.notes ?? [])
      .filter((n: any) => uuid && String(n.order_id) === uuid)
      .map((n: any) => ({ message: n.message ?? "", by: (n.created_by?.name ?? n.created_by?.fb_name ?? "").trim(), at: n.created_at }))
    const sa = o.shipping_address ?? {}
    res.json({
      id: o.id,
      status: o.status,
      status_name: o.status_name,
      updated_at: o.updated_at,
      seller: o.assigning_seller ? { id: o.assigning_seller.id, name: String(o.assigning_seller.name ?? "").trim() } : null,
      marketer: o.marketer?.name ?? null,
      customer: {
        name: o.bill_full_name,
        phone: o.bill_phone_number,
        succeed_order_count: o.customer?.succeed_order_count ?? 0,
        returned_order_count: o.customer?.returned_order_count ?? 0,
        order_count: o.customer?.order_count ?? 0,
      },
      duplicated_phone: !!o.duplicated_phone,
      items: (o.items ?? []).map((i: any) => ({
        variation_id: i.variation_id ?? null,
        display_id: i.variation_info?.display_id ?? null,
        name: i.variation_info?.name ?? "",
        quantity: i.quantity,
        price: i.variation_info?.retail_price ?? 0,
        discount_each: i.discount_each_product ?? 0,
        one_time_product: !i.variation_id,
      })),
      total_price: o.total_price,
      discount: o.total_discount ?? 0,
      shipping_fee: o.shipping_fee ?? 0,
      is_free_shipping: !!o.is_free_shipping,
      prepaid: (o.prepaid ?? 0) + (o.transfer_money ?? 0),
      cod: o.cod,
      address: {
        full_name: sa.full_name ?? o.bill_full_name,
        phone_number: sa.phone_number ?? o.bill_phone_number,
        address: sa.address ?? "",
        full_address: sa.new_full_address ?? sa.full_address ?? "",
        province_id: sa.new_province_id ?? (String(sa.province_id ?? "").startsWith("84_VN") ? sa.province_id : null),
        commune_id: sa.new_commune_id ?? (String(sa.commune_id ?? "").startsWith("84_VN") ? sa.commune_id : null),
        render_type: sa.render_type ?? null,
      },
      landing_note: o.note ?? "",
      note_print: o.note_print ?? "",
      pkg: parseLandingPackage(o.note),
      notes,
      tags: (o.tags ?? []).map((t: any) => ({ id: t.id, name: String(t.name ?? "").trim() })),
    })
  } catch (err: any) {
    res.status(502).json({ error: err.message })
  }
}
