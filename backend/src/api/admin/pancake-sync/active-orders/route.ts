import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// In-process lock: chống bấm liên tục — lock 30s sau mỗi lần chạy
let runningUntil = 0

/**
 * POST /admin/pancake-sync/active-orders
 *
 * Sync toàn bộ đơn status=0 từ Pancake (notes + tags + status) trong 1 request.
 * Dùng cho call-board: auto-trigger khi mở trang + cron job 2 phút.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (Date.now() < runningUntil) {
      const wait = Math.ceil((runningUntil - Date.now()) / 1000)
      return res.status(429).json({ error: `Đang sync, thử lại sau ${wait}s` })
    }
    runningUntil = Date.now() + 30_000

    let syncService: any
    try {
      syncService = req.scope.resolve("pancakeSyncModule")
    } catch (e: any) {
      runningUntil = 0
      return res.status(500).json({ error: "resolve_failed", detail: e.message })
    }

    const result = await syncService.syncActiveOrders()
    runningUntil = 0
    return res.json({ ok: true, ...result })
  } catch (err: any) {
    runningUntil = 0
    console.error("[active-orders] failed:", err)
    return res.status(500).json({ error: "sync_failed", detail: err?.message ?? String(err) })
  }
}
