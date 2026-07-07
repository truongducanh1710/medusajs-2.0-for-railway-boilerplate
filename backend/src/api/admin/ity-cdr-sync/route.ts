import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/ity-cdr-sync
 * Trigger sync CDR thủ công cho 1 khoảng ngày.
 * Body: { from: ISODateString, to: ISODateString }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.body as { from?: string; to?: string }

    if (!from || !to) {
      return res.status(400).json({
        error: "Missing required fields: from, to (ISO date strings)",
      })
    }

    const fromDate = new Date(from)
    const toDate = new Date(to)

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({
        error: "Invalid date format. Use ISO 8601 (e.g. 2026-07-01)",
      })
    }

    const syncService = req.scope.resolve("ityCdrSyncModule") as any
    const { jobId } = await syncService.pullByDateRange(fromDate, toDate)

    return res.status(202).json({ jobId })
  } catch (err: any) {
    console.error("[ItyCdrSync API] Error:", err.message)

    if (err.code === "SYNC_IN_PROGRESS" || err.message?.includes("SYNC_IN_PROGRESS")) {
      return res.status(409).json({
        error: "Một job sync khác đang chạy. Vui lòng đợi job đó hoàn tất.",
        existingJobId: err.existingJobId,
      })
    }

    return res.status(500).json({ error: err.message })
  }
}
