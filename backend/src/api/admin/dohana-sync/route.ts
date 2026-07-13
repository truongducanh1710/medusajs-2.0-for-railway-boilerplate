import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/dohana-sync
 * Body: { from: ISOString, to: ISOString }
 * Trigger sync thủ công (nút "Đồng bộ lại" trên UI).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.body as { from?: string; to?: string }

    if (!from || !to) {
      return res.status(400).json({ error: "Missing from/to" })
    }

    const syncService = req.scope.resolve("dohanaSyncModule") as any
    const { jobId } = await syncService.pullByDateRange(new Date(from), new Date(to))

    return res.json({ jobId })
  } catch (err: any) {
    if (err.code === "SYNC_IN_PROGRESS") {
      return res.status(409).json({ error: err.message, existingJobId: err.existingJobId })
    }
    console.error("[DohanaSync Trigger API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
