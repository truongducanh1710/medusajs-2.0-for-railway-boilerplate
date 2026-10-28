import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"

/**
 * GET /admin/auto-scale/candidates?q= — camp CBO đang chạy 3 ngày gần đây để chọn gắn.
 * Kèm chi tiêu + số đơn 7 ngày để biết camp nào đáng gắn.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  const q = String((req.query as any).q || "").trim()
  const params: any[] = []
  let where = `deleted_at IS NULL AND date >= current_date - 3 AND daily_budget IS NOT NULL AND daily_budget > 0`
  if (!auth.isSuper) { params.push(auth.mktCodes); where += ` AND mkt_name = ANY($${params.length})` }
  if (q) { params.push(`%${q}%`); where += ` AND campaign_name ILIKE $${params.length}` }

  const { rows } = await getPool().query(
    `WITH c AS (
       SELECT DISTINCT ON (campaign_id) campaign_id, campaign_name, mkt_name, ad_account_id, daily_budget, effective_status
         FROM mkt_ads_cost WHERE ${where}
        ORDER BY campaign_id, date DESC
     )
     SELECT c.*,
       (SELECT COALESCE(SUM(spend),0)::bigint FROM mkt_ads_cost m WHERE m.campaign_id = c.campaign_id AND m.date >= current_date - 6) AS spend_7d,
       (SELECT COUNT(*)::int FROM pancake_order p
         WHERE (p.raw->>'p_utm_campaign' = c.campaign_id OR p.raw->>'p_utm_source' = c.campaign_name)
           AND p.pancake_created_at >= now() - interval '7 days' AND p.deleted_at IS NULL
           AND NOT (p.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
           AND NOT (p.tags @> '[{"name":"Đơn nháp"}]'::jsonb AND p.status IN (0, 11, 6, 7, -1))
           AND p.status NOT IN (6, 7, -1)) AS orders_7d,
       (SELECT rule_id FROM auto_scale_camp a WHERE a.campaign_id = c.campaign_id) AS rule_id
     FROM c
     ORDER BY (c.effective_status = 'ACTIVE') DESC, spend_7d DESC
     LIMIT 60`,
    params
  )
  return res.json({ candidates: rows })
}
