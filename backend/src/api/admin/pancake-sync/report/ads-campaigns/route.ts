import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/ads-campaigns
 * Current campaign list from the latest mkt_ads_cost snapshot.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { account_id, mkt_code, q, status, limit = "50" } = req.query as Record<string, string>
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200)
    const sql = req.scope.resolve("cskhAnalysisModule") as any

    const params: any[] = []
    const conds = ["deleted_at IS NULL"]
    if (account_id) {
      params.push(account_id.startsWith("act_") ? account_id : `act_${account_id}`)
      conds.push(`ad_account_id = $${params.length}`)
    }
    if (mkt_code) {
      params.push(mkt_code)
      conds.push(`mkt_name = $${params.length}`)
    }
    if (status) {
      params.push(status.toUpperCase())
      conds.push(`effective_status = $${params.length}`)
    }
    if (q) {
      params.push(`%${q}%`)
      conds.push(`campaign_name ILIKE $${params.length}`)
    }
    params.push(lim)

    const rows = await sql.sql(`
      SELECT DISTINCT ON (campaign_id)
        campaign_id,
        campaign_name,
        mkt_name,
        ad_account_id,
        effective_status,
        daily_budget,
        learning_stage,
        spend AS spend_latest_day,
        impressions AS impressions_latest_day,
        clicks AS clicks_latest_day,
        date::text AS latest_date,
        updated_at
      FROM mkt_ads_cost
      WHERE ${conds.join(" AND ")}
      ORDER BY campaign_id, date DESC, updated_at DESC
      LIMIT $${params.length}
    `, params)

    return res.json({ rows, total: rows.length })
  } catch (err: any) {
    console.error("[ads-campaigns]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
