import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/logs
 * Query: type=cron|webhook, limit, offset
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { type = "cron", limit = "50", offset = "0" } = req.query as Record<string, string>
    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const lim = Math.min(Number(limit) || 50, 200)
    const off = Number(offset) || 0

    if (type === "webhook") {
      const logs = await syncService.listPancakeWebhookLogs(
        {},
        { take: lim, skip: off, order: { received_at: "DESC" } }
      )
      return res.json({ logs, type: "webhook" })
    }

    // type === "cron" (default)
    const logs = await syncService.listPancakeCronLogs(
      {},
      { take: lim, skip: off, order: { started_at: "DESC" } }
    )

    // Status distribution from DB (real-time)
    const statusRows = await syncService.listPancakeOrders(
      {},
      { take: 0, select: ["status", "status_name"] as any }
    ).catch(() => [])

    return res.json({ logs, type: "cron" })
  } catch (err: any) {
    console.error("[pancake-sync/logs]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
