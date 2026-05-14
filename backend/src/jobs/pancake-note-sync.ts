/**
 * Pancake note sync — chạy mỗi 15 phút.
 * Lấy đơn trong 3 ngày gần nhất, fetch detail từng đơn để lấy customer.notes,
 * update notes + last_note_at + call_count + tags vào DB.
 *
 * Mỗi batch xử lý tối đa 100 đơn, delay 300ms giữa mỗi request để tránh rate limit.
 */

import { MedusaContainer } from "@medusajs/framework"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "../lib/constants"

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
const BATCH_LIMIT = 100
const REQUEST_DELAY_MS = 300

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractNotes(raw: any): { notes: any[]; lastNoteAt: Date | null; callCount: number } {
  // order_link = "https://.../order?order_id=<UUID>" — UUID này khớp với note.order_id
  const orderUUID = (() => {
    try {
      const link: string = raw?.order_link ?? ""
      return new URL(link).searchParams.get("order_id") ?? ""
    } catch { return "" }
  })()

  const allNotes: any[] = raw?.customer?.notes ?? []
  // Chỉ lấy note của đơn này; nếu không có order_id trên note thì bỏ qua
  const customerNotes = orderUUID
    ? allNotes.filter((n: any) => String(n.order_id ?? "") === orderUUID)
    : allNotes

  const notes = customerNotes.map((n: any) => ({
    message: n.message ?? "",
    by: n.created_by?.name ?? n.created_by?.fb_name ?? "",
    at_ms: n.created_at ?? 0,
  }))

  const lastNoteMs = notes.reduce((max, n) => Math.max(max, n.at_ms ?? 0), 0)
  const lastNoteAt = lastNoteMs > 0 ? new Date(lastNoteMs) : null

  const callCount = notes.filter((n) =>
    n.message?.toUpperCase().includes("KNM")
  ).length

  return { notes, lastNoteAt, callCount }
}

function extractTags(raw: any): any[] {
  return Array.isArray(raw?.tags) ? raw.tags : []
}

export default async function pancakeNoteSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("pancakeSyncModule") as any

  const since = new Date(Date.now() - THREE_DAYS_MS)

  // Lấy đơn trong 3 ngày gần nhất từ DB
  let orders: any[]
  try {
    orders = await syncService.listPancakeOrders(
      {},
      { take: BATCH_LIMIT, order: { pancake_created_at: "DESC" } }
    )
    // Filter sau khi lấy về (Medusa ORM không hỗ trợ filter gte trực tiếp dễ)
    orders = orders.filter((o: any) => {
      const d = o.pancake_created_at ? new Date(o.pancake_created_at) : null
      return d && d >= since
    })
  } catch (err: any) {
    logger?.error?.(`[PancakeNoteSync] Failed to list orders: ${err.message}`)
    return
  }

  if (orders.length === 0) {
    logger?.info?.("[PancakeNoteSync] No recent orders to sync notes for")
    return
  }

  logger?.info?.(`[PancakeNoteSync] Syncing notes for ${orders.length} orders`)

  let updated = 0
  let failed = 0

  for (const order of orders) {
    try {
      // Bỏ qua nếu note đã được sync trong 30 phút qua (trừ khi chưa có note)
      if (order.last_note_at) {
        const age = Date.now() - new Date(order.last_note_at).getTime()
        if (age < 30 * 60 * 1000) continue
      }

      const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/orders/${order.id}?api_key=${PANCAKE_API_KEY}`
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        failed++
        continue
      }
      const body = await res.json()
      const raw = body?.data?.data ?? body?.data ?? body

      const { notes, lastNoteAt, callCount } = extractNotes(raw)
      const tags = extractTags(raw)

      await syncService.updatePancakeOrders({
        id: order.id,
        notes,
        last_note_at: lastNoteAt,
        call_count: callCount,
        tags,
      })
      updated++
    } catch (err: any) {
      logger?.warn?.(`[PancakeNoteSync] Order ${order.id} failed: ${err.message}`)
      failed++
    }

    await delay(REQUEST_DELAY_MS)
  }

  logger?.info?.(`[PancakeNoteSync] Done — updated=${updated} failed=${failed}`)
}

export const config = {
  name: "pancake-note-sync",
  schedule: "*/15 * * * *",
}
