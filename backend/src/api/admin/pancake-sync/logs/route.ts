import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/logs?type=cron|webhook&limit=50&offset=0
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { type = "cron", limit = "50", offset = "0" } = req.query as Record<string, string>
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    const lim = Math.min(Number(limit) || 50, 200)
    const off = Number(offset) || 0

    if (type === "webhook") {
      const logs = await cskhService.sql(
        `SELECT * FROM pancake_webhook_log WHERE deleted_at IS NULL ORDER BY received_at DESC LIMIT ${lim} OFFSET ${off}`
      ).catch(() => [])
      return res.json({ logs, type: "webhook" })
    }

    const logs = await cskhService.sql(
      `SELECT * FROM pancake_cron_log WHERE deleted_at IS NULL ORDER BY started_at DESC LIMIT ${lim} OFFSET ${off}`
    ).catch(() => [])

    return res.json({ logs, type: "cron" })
  } catch (err: any) {
    console.error("[pancake-sync/logs]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
