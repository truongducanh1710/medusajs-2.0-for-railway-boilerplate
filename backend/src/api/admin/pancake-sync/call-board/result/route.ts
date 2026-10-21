import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { pos, SALE_ROSTER, getPosTags } from "../../../../../lib/sale-queue"

const OUTCOME_LABEL: Record<string, string> = {
  chot: "Chốt",
  knm: "KNM",
  may_ban: "Máy bận",
  thue_bao: "Thuê bao",
  zalo: "Đã nhắn Zalo",
  hen: "Hẹn gọi lại",
  huy: "Hủy",
  note: "Ghi note",
}
// Outcomes that only add a note — allowed on orders that already left status 0, so a sale
// can back-fill the note for a call made on an order confirmed directly in POS.
const NOTE_ONLY = new Set(["knm", "may_ban", "thue_bao", "zalo", "note"])

const fmtVND = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ"

/**
 * POST /admin/pancake-sync/call-board/result
 * Sale ghi kết quả 1 cuộc gọi (+ sửa đơn nếu có) → đẩy thẳng sang POS.
 *
 * Mỗi lần gọi = đúng 1 note trên POS (luật của shop): kết quả + mọi thay đổi đơn gộp
 * chung vào 1 note. Thứ tự: sửa đơn/tag → đổi trạng thái → note → hẹn gọi, để note không
 * bao giờ nói "Chốt" khi việc ghi đơn thất bại.
 *
 * Body: { order_id, outcome, callback_at?, cancel_reason?, extra_note?, base_updated_at?,
 *         edits?: { items?, discount?, shipping_fee?, is_free_shipping?, address?, note_print? } }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const b = (req.body ?? {}) as any
  const orderId = String(b.order_id ?? "").replace(/\D/g, "")
  const outcome = String(b.outcome ?? "")
  const edits = b.edits && typeof b.edits === "object" ? b.edits : null
  const extra = String(b.extra_note ?? "").trim()

  if (!orderId) return res.status(400).json({ error: "Thiếu mã đơn" })
  if (!OUTCOME_LABEL[outcome]) return res.status(400).json({ error: "Chọn kết quả cuộc gọi" })
  const cancelReason = String(b.cancel_reason ?? "").trim()
  if (outcome === "huy" && !cancelReason) return res.status(400).json({ error: "Hủy đơn phải có lý do" })
  if (outcome === "note" && !extra) return res.status(400).json({ error: "Nhập nội dung note" })
  const callbackAt = outcome === "hen" ? new Date(b.callback_at) : null
  if (outcome === "hen" && (!callbackAt || isNaN(callbackAt.getTime()) || callbackAt.getTime() < Date.now() - 60_000)) {
    return res.status(400).json({ error: "Giờ hẹn gọi lại không hợp lệ" })
  }

  // Note author: Pancake records the API account as creator, so the sale's name goes in the text.
  let author = "Web"
  const actorId = (req as any).auth_context?.actor_id
  if (actorId) {
    const user: any = await req.scope.resolve(Modules.USER)
      .retrieveUser(actorId, { select: ["email", "first_name", "last_name"] }).catch(() => null)
    author = SALE_ROSTER.find((s) => s.adminEmail === user?.email)?.name
      ?? ([user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.email || "Web")
  }

  let o: any
  try {
    o = (await pos("GET", `/orders/${orderId}`))?.data
  } catch (err: any) {
    return res.status(502).json({ error: `Không đọc được đơn trên POS: ${err.message}` })
  }
  if (!o) return res.status(404).json({ error: "Không thấy đơn trên POS" })
  const isNew = o.status === 0
  if (!isNew && (!NOTE_ONLY.has(outcome) || edits)) {
    return res.status(409).json({ error: "Đơn đã rời trạng thái Mới trên POS — chỉ ghi được note, không sửa/chốt/hủy được nữa" })
  }
  if (edits && b.base_updated_at && o.updated_at !== b.base_updated_at) {
    return res.status(409).json({ error: "Đơn vừa được sửa trên POS sau khi bạn mở — tải lại đơn rồi sửa lại" })
  }

  // ---- Build the order update ----
  const put: Record<string, any> = {}
  const changes: string[] = []
  if (edits?.items) {
    const items = Array.isArray(edits.items) ? edits.items : []
    if (!items.length) return res.status(400).json({ error: "Đơn phải có ít nhất 1 sản phẩm" })
    for (const it of items) {
      if (!Number.isInteger(Number(it.quantity)) || Number(it.quantity) < 1) return res.status(400).json({ error: `Số lượng không hợp lệ: ${it.name}` })
      if (!(Number(it.price) >= 0)) return res.status(400).json({ error: `Giá không hợp lệ: ${it.name}` })
    }
    put.items = items.map((it: any) => ({
      variation_id: it.variation_id || null,
      quantity: Number(it.quantity),
      is_bonus_product: false,
      is_discount_percent: false,
      is_wholesale: false,
      one_time_product: !it.variation_id,
      discount_each_product: 0,
      variation_info: { name: String(it.name ?? ""), retail_price: Math.round(Number(it.price)) },
    }))
    changes.push("SP: " + items.map((it: any) => `${it.name} x${it.quantity}${Number(it.price) === 0 ? " (quà)" : ""}`).join(", "))
  }
  const subtotal = (put.items ?? (o.items ?? []).map((i: any) => ({ quantity: i.quantity, variation_info: i.variation_info })))
    .reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.variation_info?.retail_price ?? 0), 0)
  if (edits && edits.discount !== undefined && Number(edits.discount) !== Number(o.total_discount ?? 0)) {
    const d = Math.round(Number(edits.discount))
    if (!(d >= 0) || d > subtotal) return res.status(400).json({ error: "Giảm giá không hợp lệ" })
    if (d > subtotal * 0.15 && !extra) {
      return res.status(400).json({ error: "Giảm trên 15% tiền hàng — ghi lý do vào ô ghi thêm" })
    }
    put.discount = d // NOT total_discount: Pancake ignores that field on update
    changes.push(`Giảm giá ${fmtVND(d)}`)
  }
  if (edits && edits.shipping_fee !== undefined && Number(edits.shipping_fee) !== Number(o.shipping_fee ?? 0)) {
    put.shipping_fee = Math.max(0, Math.round(Number(edits.shipping_fee)))
    changes.push(`Ship ${fmtVND(put.shipping_fee)}`)
  }
  if (edits && edits.is_free_shipping !== undefined && !!edits.is_free_shipping !== !!o.is_free_shipping) {
    put.is_free_shipping = !!edits.is_free_shipping
    changes.push(put.is_free_shipping ? "Miễn ship" : "Khách trả ship")
  }
  if (edits?.address) {
    const a = edits.address
    if (!a.province_id || !a.commune_id) return res.status(400).json({ error: "Chọn tỉnh và phường/xã" })
    put.shipping_address = {
      full_name: a.full_name || o.bill_full_name,
      phone_number: a.phone_number || o.bill_phone_number,
      address: String(a.address ?? "").trim(),
      province_id: a.province_id,
      commune_id: a.commune_id,
      district_id: null,
      render_type: "new",
      country_code: "84",
    }
    changes.push(`Địa chỉ: ${[put.shipping_address.address, a.commune_name, a.province_name].filter(Boolean).join(", ")}`)
  }
  if (edits && edits.note_print !== undefined && String(edits.note_print) !== String(o.note_print ?? "")) {
    put.note_print = String(edits.note_print)
    changes.push(`In: ${put.note_print}`)
  }
  // ---- Tags: only what the sale picked (UI suggests, never auto-applies). Tags already on
  // the POS order are always kept — the PUT replaces the whole list, so send current + added.
  if (Array.isArray(edits?.add_tags) && edits.add_tags.length) {
    let shopTags: { id: number; name: string; system: boolean }[] = []
    try { shopTags = await getPosTags() } catch {}
    const byId = new Map(shopTags.map((t) => [t.id, t]))
    const current: number[] = (o.tags ?? []).map((t: any) => Number(t.id))
    const added = [...new Set(edits.add_tags.map(Number))]
      .filter((id: number) => byId.has(id) && !byId.get(id)!.system && !current.includes(id)) as number[]
    if (added.length) {
      put.tags = [...current, ...added]
      changes.push(`Thẻ: ${added.map((id) => byId.get(id)!.name).join(", ")}`)
    }
  }

  const warnings: string[] = []
  let cod: number | null = null
  try {
    if (Object.keys(put).length) {
      const r = await pos("PUT", `/orders/${orderId}`, put)
      cod = r?.data?.cod ?? null
    }
    if (outcome === "chot" || outcome === "huy") {
      await pos("PUT", `/orders/${orderId}`, { status: outcome === "chot" ? 1 : 6 })
    }
  } catch (err: any) {
    return res.status(502).json({ error: `POS từ chối: ${err.message}` })
  }

  // ---- One note for this call ----
  const parts = [author]
  if (outcome === "hen" && callbackAt) {
    const vn = new Date(callbackAt.getTime() + 7 * 3600_000)
    parts.push(`Hẹn gọi ${String(vn.getUTCHours()).padStart(2, "0")}:${String(vn.getUTCMinutes()).padStart(2, "0")} ${vn.getUTCDate()}/${vn.getUTCMonth() + 1}`)
  } else {
    parts.push(OUTCOME_LABEL[outcome])
  }
  if (outcome === "huy") parts.push(`Lý do: ${cancelReason}`)
  parts.push(...changes)
  if (changes.length && cod != null) parts.push(`COD ${fmtVND(cod)}`)
  if (extra) parts.push(extra)
  const message = parts.join(" · ")

  const customerId = o.customer?.customer_id
  try {
    if (!customerId) throw new Error("đơn chưa có khách hàng")
    await pos("POST", `/customers/${customerId}/create_note`, { message, order_id: Number(o.system_id ?? o.id) })
  } catch (err: any) {
    warnings.push(`Đã ghi đơn nhưng CHƯA ghi được note: ${err.message}. Ghi tay trên POS: "${message}"`)
  }

  if (outcome === "hen" && callbackAt) {
    try {
      await pos("POST", `/order_call_laters`, {
        order_call_later: {
          status: 0,
          needs_call_at: callbackAt.toISOString(),
          phone_number: o.bill_phone_number,
          order_ids: [String(orderId)],
          notice_created: message,
          need_notify_users: o.assigning_seller?.id ? [o.assigning_seller.id] : [],
        },
      })
    } catch (err: any) {
      warnings.push(`Chưa tạo được nhắc hẹn trên POS: ${err.message}`)
    }
  }

  try {
    await (req.scope.resolve("pancakeSyncModule") as any).refreshOrderFromPos(orderId)
  } catch (err: any) {
    warnings.push(`Đã ghi POS, bảng sẽ cập nhật sau ít phút (${err.message})`)
  }

  console.log(`[call-board/result] #${orderId} ${author} ${outcome} edits=${Object.keys(put).join(",") || "-"}`)
  res.json({ ok: true, message, warnings })
}
