// Webcake draft orders that the customer later completed.
import { pos } from "./sale-queue"

/**
 * Webcake pushes a half-filled landing form (name + phone, no address) to POS as an order
 * tagged "Đơn nháp". When the customer then submits the full form, Webcake updates that SAME
 * POS order (new webcms_id, new "Order ID" in the note, address filled) but leaves the draft
 * tag on — #99405 (13/11/2026): draft 10:16 → completed 10:22, still "Đơn nháp".
 * The tag hides the order from MKT revenue (MKT_ORDER_FILTER_SQL) and misleads sales.
 * User 13/11/2026: remove the tag on such orders from now on; older orders are left alone.
 */
const DRAFT_TAG_ID = 39
const FIX_FROM = Date.parse("2026-11-13T08:00:00Z")
const CANCELED = new Set([6, 7, -1])

const tagId = (t: any) => Number(typeof t === "object" && t !== null ? t.id : t)

export type DraftPlan = { skip: string } | { tags: number[] }

/** Pure: decide whether to drop the draft tag. Re-runs after the fix return skip (no loop). */
export function planDraftUntag(o: any): DraftPlan {
  if (String(o?.order_sources) !== "-7") return { skip: "không phải Webcake" }
  const tags: number[] = (o?.tags ?? []).map(tagId).filter((n: number) => Number.isFinite(n))
  if (!tags.includes(DRAFT_TAG_ID)) return { skip: "không có tag Đơn nháp" }
  if (CANCELED.has(Number(o?.status))) return { skip: "đơn đã huỷ/xoá" }
  const ins = String(o?.inserted_at ?? "")
  if (!(Date.parse(ins + (/[zZ]|[+-]\d\d:?\d\d$/.test(ins) ? "" : "Z")) >= FIX_FROM)) {
    return { skip: "đơn trước ngày áp dụng" }
  }
  // Completed = Webcake re-submitted the form onto this order (webcms_id replaced).
  const completed = (o?.histories ?? []).some((h: any) => h?.webcms_id?.old && h?.webcms_id?.new && h.webcms_id.old !== h.webcms_id.new)
  if (!completed) return { skip: "khách chưa gửi lại form" }
  if (!String(o?.shipping_address?.address ?? "").trim()) return { skip: "chưa có địa chỉ" }
  return { tags: tags.filter((t) => t !== DRAFT_TAG_ID) }
}

/** VN shop only. Returns a log line when the tag was removed, undefined otherwise. */
export async function untagCompletedDraft(o: any): Promise<string | undefined> {
  const plan = planDraftUntag(o)
  if ("skip" in plan) return undefined
  // Re-read just before writing: PUT tags replaces the whole list, so use the freshest tags.
  const fresh = (await pos("GET", `/orders/${o.id}`))?.data ?? o
  const freshPlan = planDraftUntag(fresh)
  if ("skip" in freshPlan) return undefined
  await pos("PUT", `/orders/${o.id}`, { tags: freshPlan.tags })
  return `gỡ tag Đơn nháp (khách đã gửi đủ form), tags còn: ${freshPlan.tags.join(",") || "—"}`
}
