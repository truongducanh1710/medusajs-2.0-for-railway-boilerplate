import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/jobs?limit=20&market=MY
 * List các job sync gần nhất (mới nhất trước) để xem lịch sử: job gần nhất sync
 * được bao nhiêu đơn, cập nhật gì, có dừng sớm không — không cần biết trước jobId.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { market, limit } = req.query as Record<string, string | undefined>
    const take = Math.min(Number(limit) || 20, 100)

    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const jobs = await syncService.listPancakeSyncJobs(
      market ? { market } : {},
      { take, order: { started_at: "DESC" } }
    )

    return res.json({
      jobs: jobs.map((j: any) => ({
        id: j.id,
        market: j.market,
        status: j.status,
        from_date: j.from_date,
        to_date: j.to_date,
        started_at: j.started_at,
        finished_at: j.finished_at,
        stats: j.stats,
        error: j.error,
      })),
    })
  } catch (err: any) {
    console.error("[PancakeSync Jobs API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
