import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/pancake-sync
 * Trigger a Pancake order sync job for a date range.
 * Body: { from: ISODateString, to: ISODateString, force?: boolean }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to, force } = req.body as {
      from?: string
      to?: string
      force?: boolean
    }

    if (!from || !to) {
      return res.status(400).json({
        error: "Missing required fields: from, to (ISO date strings)",
      })
    }

    const fromDate = new Date(from)
    const toDate = new Date(to)

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({
        error: "Invalid date format. Use ISO 8601 (e.g. 2026-05-01T00:00:00Z)",
      })
    }

    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const { jobId } = await syncService.pullByDateRange(fromDate, toDate, { force })

    return res.status(202).json({ jobId })
  } catch (err: any) {
    console.error("[PancakeSync API] Error:", err.message)

    if (err.code === "SYNC_IN_PROGRESS" || err.message?.includes("SYNC_IN_PROGRESS")) {
      return res.status(409).json({
        error: "Một job sync khác đang chạy. Vui lòng đợi job đó hoàn tất.",
        existingJobId: err.existingJobId,
      })
    }

    return res.status(500).json({ error: err.message })
  }
}
