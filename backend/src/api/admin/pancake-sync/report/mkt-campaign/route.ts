import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/mkt-campaign?date=2026-05-23&mkt=KIENLB
 * Danh sách campaigns FB Ads trong ngày — spend, impressions, clicks.
 * Không JOIN đơn hàng (quá chậm). Dùng để marketer xem chi phí theo camp hôm nay.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { date = today, mkt } = req.query as Record<string, string>

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const params: any[] = [date]
    const mktFilter = mkt ? `AND mkt_name = $2` : ""
    if (mkt) params.push(mkt)

    const rows = await cskhService.sql(`
      SELECT
        c.campaign_id,
        c.campaign_name,
        c.mkt_name,
        c.spend::bigint,
        c.impressions::int,
        c.clicks::int,
        COUNT(o.id)::int AS total_orders,
        SUM(CASE WHEN o.status = 3 THEN 1 ELSE 0 END)::int AS delivered,
        SUM(CASE WHEN o.status IN (6,7,-1,-2) THEN 1 ELSE 0 END)::int AS cancelled,
        SUM(CASE WHEN o.status NOT IN (-2,7) THEN o.cod_amount ELSE 0 END)::bigint AS cod_total,
        SUM(CASE WHEN o.status = 3 THEN o.cod_amount ELSE 0 END)::bigint AS cod_delivered,
        CASE
          WHEN SUM(CASE WHEN o.status NOT IN (-2,7) THEN o.cod_amount ELSE 0 END) > 0
          THEN ROUND(c.spend::numeric / SUM(CASE WHEN o.status NOT IN (-2,7) THEN o.cod_amount ELSE 0 END) * 100, 2)
          ELSE NULL
        END AS care_pct
      FROM mkt_ads_cost c
      LEFT JOIN pancake_order o
        ON o.deleted_at IS NULL
        AND o.source IN ('manual','webcake')
        AND NOT (o.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
        AND o.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND o.pancake_created_at < (($1::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND (o.raw->>'p_utm_source' = c.campaign_name OR o.raw->>'p_utm_campaign' = c.campaign_name)
      WHERE c.deleted_at IS NULL
        AND c.date = $1::date
        ${mktFilter}
      GROUP BY c.campaign_id, c.campaign_name, c.mkt_name, c.spend, c.impressions, c.clicks
      ORDER BY c.spend DESC
    `, params)

    return res.json({ rows, date, mkt: mkt || null })
  } catch (err: any) {
    console.error("[report/mkt-campaign]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
