/**
 * Trích note & tag từ raw Pancake order response.
 *
 * Pancake `customer.notes` chứa note của TẤT CẢ đơn của khách hàng đó.
 * Mỗi note có field `order_id` là UUID — khớp với `order_id` query param trong `order_link`.
 * Phải lọc theo UUID này để chỉ lấy note của đúng đơn hiện tại.
 */

export type PancakeNote = {
  message: string
  by: string
  at_ms: number
}

export type ExtractedNotes = {
  notes: PancakeNote[]
  lastNoteAt: Date | null
  callCount: number
}

export function extractNotesForOrder(raw: any): ExtractedNotes {
  // order_link: https://pos.pages.fm/shop/{shop_id}/order?order_id=<UUID>
  const orderUUID = (() => {
    try {
      const link: string = raw?.order_link ?? ""
      return new URL(link).searchParams.get("order_id") ?? ""
    } catch {
      return ""
    }
  })()

  const allNotes: any[] = Array.isArray(raw?.customer?.notes) ? raw.customer.notes : []

  // Không có UUID → trả rỗng (safer hơn là lấy note của đơn khác)
  const filtered = orderUUID
    ? allNotes.filter((n: any) => String(n.order_id ?? "") === orderUUID)
    : []

  const notes: PancakeNote[] = filtered.map((n: any) => ({
    message: n.message ?? "",
    by: n.created_by?.name ?? n.created_by?.fb_name ?? "",
    at_ms: n.created_at ?? 0,
  }))

  const lastNoteMs = notes.reduce((max, n) => Math.max(max, n.at_ms ?? 0), 0)
  const lastNoteAt = lastNoteMs > 0 ? new Date(lastNoteMs) : null

  const callCount = notes.filter((n) =>
    String(n.message ?? "").toUpperCase().includes("KNM")
  ).length

  return { notes, lastNoteAt, callCount }
}

export function extractTags(raw: any): any[] {
  return Array.isArray(raw?.tags) ? raw.tags : []
}
