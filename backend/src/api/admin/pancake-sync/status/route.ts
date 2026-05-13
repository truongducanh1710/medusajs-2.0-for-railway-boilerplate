import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/status?jobId=...
 * Poll sync job status and stats.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const jobId = req.query.jobId as string | undefined

    if (!jobId) {
      return res.status(400).json({ error: "Missing query param: jobId" })
    }

    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const jobs = await syncService.listPancakeSyncJobs(
      { id: jobId },
      { take: 1 }
    )

    if (jobs.length === 0) {
      return res.status(404).json({ error: "Job not found" })
    }

    const job = jobs[0]

    return res.json({
      status: job.status,
      from_date: job.from_date,
      to_date: job.to_date,
      started_at: job.started_at,
      finished_at: job.finished_at,
      stats: job.stats,
      error: job.error,
    })
  } catch (err: any) {
    console.error("[PancakeSync Status API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
