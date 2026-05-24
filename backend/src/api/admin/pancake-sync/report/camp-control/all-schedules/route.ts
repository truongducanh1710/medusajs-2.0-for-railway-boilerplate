import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/camp-control/all-schedules
 * Query: status=pending|done|failed|cancelled (optional), limit=50, offset=0
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { status, limit = "50", offset = "0", mkt } = req.query as Record<string, string>
    const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200)
    const off = Math.max(parseInt(offset) || 0, 0)

    const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any

    const conditions: string[] = ["deleted_at IS NULL"]
    const params: any[] = []

    if (status) {
      params.push(status)
      conditions.push(`status = $${params.length}`)
    }
    if (mkt) {
      params.push(`%_${mkt}_%`)
      conditions.push(`campaign_name ILIKE $${params.length}`)
    }

    const where = conditions.join(" AND ")
    params.push(lim, off)

    const schedules = await sqlSvc.sql(
      `SELECT id, campaign_id, campaign_name, action, payload, scheduled_at,
              executed_at, status, error_message, created_by_email, created_at
       FROM camp_schedule
       WHERE ${where}
       ORDER BY scheduled_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ).catch(() => [])

    const countRows = await sqlSvc.sql(
      `SELECT COUNT(*)::int as total FROM camp_schedule WHERE ${where}`,
      params.slice(0, -2)
    ).catch(() => [{ total: 0 }])

    return res.json({ schedules, total: countRows[0]?.total ?? 0 })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
