// Duplicate landing submissions merged by POS into one order.
import { pos, parseLandingPackage } from "./sale-queue"

/**
 * When a customer submits the same landing form twice, POS merges both into ONE order:
 * the note holds one block per submission (separated by "------------", each ending in
 * "Order ID: n") and item quantities are summed, while the discount is kept for one
 * package only — #97879: 2 × "3 THÙNG 1.299k" → 6 thùng, COD 2.799k.
 * Shop rule (30/10/2026): keep the package of the LATEST submission (highest Order ID).
 * Orders before FIX_FROM are left to sales.
 */
const FIX_FROM = Date.parse("2026-10-30T05:00:00Z")

const fmtK = (n: number) => `${Math.round(n / 1000).toLocaleString("vi-VN")}k`

type Block = { orderId: number; product: string; pkgText: string; price: number | null; qty: number | null }

function parseBlocks(note: string): Block[] {
  return note.split(/\r?\n\s*-{6,}\s*\r?\n/).map((b) => {
    const pkg = parseLandingPackage(b)
    // "LOẠI TO: 3 THÙNG 1.299k", "MUA 2 CHẢO 1.599K" — first small number followed by a word
    // (not "k"/"vnđ"; \b is useless here, "Ệ" in "KỆ" is not a \w char).
    const q = pkg?.text.match(/(?:^|[\s:])(\d{1,2})\s+(?!(?:k|vn[dđ]?)(?![a-zà-ỹ]))[a-zà-ỹ]/i)
    return {
      orderId: Number(b.match(/Order ID:\s*(\d+)/i)?.[1] ?? NaN),
      product: (b.match(/^\s*SP:\s*([^\r\n]*)/im)?.[1] ?? "").replace(/[,\s]+$/, "").trim().toUpperCase(),
      pkgText: pkg?.text ?? "",
      price: pkg?.price ?? null,
      qty: q ? Number(q[1]) : null,
    }
  })
}

export type DedupPlan =
  | { skip: string }
  | { put: Record<string, any>; message: string; expectedCod: number }

/** Pure: decide how to fix a merged order. Re-runs on the fixed order return skip (no loop). */
export function planLandingDedup(o: any): DedupPlan {
  if (Number(o?.status) !== 0) return { skip: "không còn ở trạng thái mới" }
  if (!(Date.parse(o?.inserted_at + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(o?.inserted_at)) ? "" : "Z")) >= FIX_FROM)) {
    return { skip: "đơn trước ngày áp dụng" }
  }
  const blocks = parseBlocks(String(o?.note ?? ""))
  if (blocks.length < 2) return { skip: "không gộp" }
  if (blocks.some((b) => !Number.isFinite(b.orderId) || !b.product)) return { skip: "ghi chú lạ" }
  if (new Set(blocks.map((b) => b.product)).size > 1) return { skip: "khác sản phẩm — khách mua thêm" }

  const latest = blocks.reduce((a, b) => (b.orderId > a.orderId ? b : a))
  const n = latest.qty
  const price = latest.price
  if (!n || !price) return { skip: "không đọc được gói" }

  const items: any[] = o?.items ?? []
  const retailOf = (i: any) => Number(i.variation_info?.retail_price ?? 0)
  // Main product = the priciest line; the rest are package extras (khay, kẹp, or a priced
  // add-on like the máy bào in "MUA 2 CHẢO ... + 1 MÁY BÀO" — #97996).
  const main = items.reduce<any>((a, i) => (!a || retailOf(i) > retailOf(a) ? i : a), null)
  if (!main || retailOf(main) <= 0) return { skip: "không có SP tính tiền" }
  if (items.filter((i) => retailOf(i) === retailOf(main)).length > 1) return { skip: "nhiều SP chính" }
  const mainQty = Number(main.quantity)
  if (mainQty <= n) return { skip: "số lượng đã đúng gói" }

  // Extras scale with the main product and are dropped when they round to 0
  // (3 kệ + 3 khay → 1 kệ + 1 khay; 3 chảo + 1 máy bào → 1 chảo).
  const scaled = items
    .map((i) => ({ i, q: i === main ? n : Math.round((Number(i.quantity) * n) / mainQty) }))
    .filter((s) => s.q >= 1)

  const discount = scaled.reduce((s, x) => s + x.q * retailOf(x.i), 0) - price
  if (discount < 0) return { skip: "giá gói cao hơn giá niêm yết" }

  const put = {
    items: scaled.map(({ i, q }) => ({
      variation_id: i.variation_id || null,
      quantity: q,
      is_bonus_product: !!i.is_bonus_product,
      is_discount_percent: false,
      is_wholesale: false,
      one_time_product: !i.variation_id,
      discount_each_product: 0,
      variation_info: { name: String(i.variation_info?.name ?? ""), retail_price: Number(i.variation_info?.retail_price ?? 0) },
    })),
    discount, // NOT total_discount: Pancake ignores that field on update
  }
  const ids = blocks.map((b) => b.orderId).sort((a, b) => a - b).join(" + ")
  const name = String(main.variation_info?.name ?? "")
  const dropped = items.filter((i) => !scaled.some((s) => s.i === i)).map((i) => String(i.variation_info?.name ?? ""))
  const message = `Hệ thống tự sửa đơn landing bị gộp trùng (Order ID ${ids}): ${name} ${mainQty} → ${n}, `
    + (dropped.length ? `bỏ ${dropped.join(", ")}, ` : "")
    + `COD ${fmtK(Number(o.cod ?? 0))} → ${fmtK(price + Number(o.shipping_fee ?? 0))} · giữ gói lần gửi sau: ${latest.pkgText}`
  return { put, message, expectedCod: price + Number(o.shipping_fee ?? 0) }
}

/** VN shop only. Returns the note written, or undefined when nothing to fix. */
export async function fixDuplicateLanding(o: any): Promise<string | undefined> {
  const plan = planLandingDedup(o)
  if ("skip" in plan) return undefined
  const r = await pos("PUT", `/orders/${o.id}`, plan.put)
  const cod = Number(r?.data?.cod ?? NaN)
  const message = cod === plan.expectedCod ? plan.message : `${plan.message} · ⚠ POS tính COD ${fmtK(cod)}, sale kiểm lại`
  const customerId = o.customer?.customer_id
  if (customerId) {
    await pos("POST", `/customers/${customerId}/create_note`, { message, order_id: Number(o.system_id ?? o.id) })
  }
  return message
}
