import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "../../../../lib/constants"

const REQUEST_DELAY_MS = 250
const MAX_ORDERS = 100

// Simple in-process lock: prevent concurrent sync-notes runs
let runningUntil = 0

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractNotes(raw: any): { notes: any[]; lastNoteAt: Date | null; callCount: number } {
  const orderUUID = (() => {
    try {
      const link: string = raw?.order_link ?? ""
      return new URL(link).searchParams.get("order_id") ?? ""
    } catch { return "" }
  })()

  const allNotes: any[] = raw?.customer?.notes ?? []
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
  const callCount = notes.filter((n) => String(n.message ?? "").toUpperCase().includes("KNM")).length
  return { notes, lastNoteAt, callCount }
}

function extractTags(raw: any): any[] {
  return Array.isArray(raw?.tags) ? raw.tags : []
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Debounce: block nếu đang có run trong 30s qua
  if (Date.now() < runningUntil) {
    const wait = Math.ceil((runningUntil - Date.now()) / 1000)
    return res.status(429).json({ error: `Đang sync, thử lại sau ${wait}s` })
  }
  runningUntil = Date.now() + 60_000 // lock 60s

  const syncService = req.scope.resolve("pancakeSyncModule") as any

  // Lấy ngày từ body (default hôm nay)
  const body = req.body as any
  const date: string = body?.date ?? new Date().toISOString().slice(0, 10)
  const dayStart = new Date(`${date}T00:00:00+07:00`)
  const dayEnd = new Date(`${date}T23:59:59+07:00`)

  try {
    // Lấy đơn trong ngày từ DB
    let orders: any[] = await syncService.listPancakeOrders(
      {},
      { take: MAX_ORDERS, order: { created_at: "DESC" } }
    )
    orders = orders.filter((o: any) => {
      const d = o.pancake_created_at ? new Date(o.pancake_created_at) : null
      return d && d >= dayStart && d <= dayEnd && o.status === 0
    })

    let updated = 0
    let failed = 0

    for (const order of orders) {
      try {
        const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/orders/${order.id}?api_key=${PANCAKE_API_KEY}`
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) { failed++; continue }

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
      } catch {
        failed++
      }
      await delay(REQUEST_DELAY_MS)
    }

    res.json({ ok: true, total: orders.length, updated, failed })
  } finally {
    runningUntil = 0
  }
}
