import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/ity-cdr-sync/status?jobId=...
 * Poll trạng thái job sync. Không truyền jobId → trả job gần nhất.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const jobId = req.query.jobId as string | undefined
    const syncService = req.scope.resolve("ityCdrSyncModule") as any

    const jobs = jobId
      ? await syncService.listItyCdrSyncJobs({ id: jobId }, { take: 1 })
      : await syncService.listItyCdrSyncJobs({}, { take: 1, order: { started_at: "DESC" } })

    if (jobs.length === 0) {
      return res.status(404).json({ error: "Job not found" })
    }

    const job = jobs[0]

    return res.json({
      id: job.id,
      status: job.status,
      from_date: job.from_date,
      to_date: job.to_date,
      started_at: job.started_at,
      finished_at: job.finished_at,
      stats: job.stats,
      error: job.error,
    })
  } catch (err: any) {
    console.error("[ItyCdrSync Status API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
