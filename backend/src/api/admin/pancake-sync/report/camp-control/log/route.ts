import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/camp-control/log?campaign_id=...&limit=20
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { campaign_id, limit = "20" } = req.query as Record<string, string>
    if (!campaign_id) return res.status(400).json({ error: "Cần campaign_id" })
    const lim = Math.min(Math.max(parseInt(limit) || 20, 1), 100)

    const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any
    const logs = await sqlSvc.sql(
      `SELECT id, action, old_value, new_value, source, user_email, success, fb_response, created_at
       FROM camp_action_log WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT ${lim}`,
      [campaign_id]
    )
    return res.json({ logs })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
