import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "../../../../lib/constants"

const REQUEST_DELAY_MS = 250
const MAX_ORDERS = 100

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
  const lastNoteMs = notes.reduce((max: number, n: any) => Math.max(max, n.at_ms ?? 0), 0)
  const lastNoteAt = lastNoteMs > 0 ? new Date(lastNoteMs) : null
  const callCount = notes.filter((n: any) => String(n.message ?? "").toUpperCase().includes("KNM")).length
  return { notes, lastNoteAt, callCount }
}

function extractTags(raw: any): any[] {
  return Array.isArray(raw?.tags) ? raw.tags : []
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (Date.now() < runningUntil) {
      const wait = Math.ceil((runningUntil - Date.now()) / 1000)
      return res.status(429).json({ error: `Đang sync, thử lại sau ${wait}s` })
    }
    runningUntil = Date.now() + 60_000

    let syncService: any
    try {
      syncService = req.scope.resolve("pancakeSyncModule")
    } catch (e: any) {
      runningUntil = 0
      return res.status(500).json({ error: "resolve_failed", detail: e.message })
    }

    const reqBody = req.body as any
    const date: string = reqBody?.date ?? new Date().toISOString().slice(0, 10)
    const dayStart = new Date(`${date}T00:00:00+07:00`)
    const dayEnd = new Date(`${date}T23:59:59+07:00`)

    // Lấy nhiều batch để tìm đủ đơn trong ngày (đơn cũ bị đẩy ra ngoài top 100)
    let orders: any[] = []
    try {
      let offset = 0
      const batchSize = 500
      while (true) {
        const batch: any[] = await syncService.listPancakeOrders(
          {},
          { take: batchSize, skip: offset, order: { pancake_created_at: "DESC" } }
        )
        if (!batch.length) break
        // Lọc đơn trong ngày
        const inDay = batch.filter((o: any) => {
          const d = o.pancake_created_at ? new Date(o.pancake_created_at) : null
          return d && d >= dayStart && d <= dayEnd && o.status === 0
        })
        orders.push(...inDay)
        // Nếu batch cuối có pancake_created_at nhỏ hơn dayStart thì dừng
        const last = batch[batch.length - 1]
        const lastDate = last?.pancake_created_at ? new Date(last.pancake_created_at) : null
        if (!lastDate || lastDate < dayStart) break
        offset += batchSize
        if (orders.length >= MAX_ORDERS) break
      }
    } catch (e: any) {
      runningUntil = 0
      return res.status(500).json({ error: "list_failed", detail: e.message })
    }

    let updated = 0
    let failed = 0

    for (const order of orders) {
      try {
        const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/orders/${order.id}?api_key=${PANCAKE_API_KEY}`
        const fetchRes = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!fetchRes.ok) { failed++; continue }

        const fetchBody = await fetchRes.json()
        const raw = fetchBody?.data?.data ?? fetchBody?.data ?? fetchBody

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
      } catch (e: any) {
        console.error(`[sync-notes] order ${order.id} failed:`, e.message)
        failed++
      }
      await delay(REQUEST_DELAY_MS)
    }

    runningUntil = 0
    return res.json({ ok: true, total: orders.length, updated, failed })
  } catch (err: any) {
    runningUntil = 0
    return res.status(500).json({ error: "unexpected", detail: err?.message ?? String(err) })
  }
}
