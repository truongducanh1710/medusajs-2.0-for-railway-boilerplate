import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { callFbApi } from "../camp-control/_lib"

/**
 * GET /admin/pancake-sync/report/campaign-setup?campaign_id=
 * DB + Meta setup details for campaign/adsets.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { campaign_id } = req.query as Record<string, string>
    if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" })
    const sql = req.scope.resolve("cskhAnalysisModule") as any

    const dbRows = await sql.sql(`
      SELECT campaign_id, campaign_name, mkt_name, ad_account_id, effective_status, daily_budget, learning_stage, date::text AS latest_date
      FROM mkt_ads_cost
      WHERE campaign_id = $1 AND deleted_at IS NULL
      ORDER BY date DESC
      LIMIT 1
    `, [campaign_id])

    const fb = await callFbApi("GET", `/${campaign_id}?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,buying_type,account_id,adsets.limit(100){id,name,status,effective_status,daily_budget,lifetime_budget,targeting,promoted_object,optimization_goal,billing_event}`)

    return res.json({
      db: dbRows[0] ?? null,
      fb_ok: fb.ok,
      fb_status: fb.status,
      fb: fb.data,
    })
  } catch (err: any) {
    console.error("[campaign-setup]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
