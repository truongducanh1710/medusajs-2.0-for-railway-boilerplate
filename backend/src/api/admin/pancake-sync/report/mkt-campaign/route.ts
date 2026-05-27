import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/mkt-campaign
 * ?date=2026-05-23&mkt=KIENLB          — single day (legacy)
 * ?from=2026-05-21&to=2026-05-27&mkt=  — date range, GROUP BY campaign_id
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const q = req.query as Record<string, string>
    const mkt = q.mkt ?? ""

    // Range mode khi có from+to (hoặc chỉ from), single-day khi chỉ có date
    const isRange = !!(q.from || q.to)
    const fromDate = q.from ?? q.date ?? today
    const toDate = q.to ?? q.date ?? today

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const params: any[] = [fromDate, toDate]
    const mktFilter = mkt ? `AND c.mkt_name = $3` : ""
    if (mkt) params.push(mkt)

    const rows = await cskhService.sql(`
      WITH ads AS (
        -- Aggregate FB ads riêng, không JOIN đơn → tránh fan-out SUM
        SELECT
          campaign_id,
          campaign_name,
          mkt_name,
          SUM(spend)::bigint                                        AS spend,
          SUM(impressions)::int                                     AS impressions,
          SUM(clicks)::int                                          AS clicks,
          MIN(date)::date                                           AS date_from,
          MAX(date)::date                                           AS date_to,
          COUNT(DISTINCT date)::int                                 AS day_count,
          (ARRAY_AGG(effective_status ORDER BY date DESC))[1]       AS effective_status,
          (ARRAY_AGG(daily_budget     ORDER BY date DESC))[1]::bigint AS daily_budget
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND date >= $1::date
          AND date <= $2::date
          ${mktFilter}
        GROUP BY campaign_id, campaign_name, mkt_name
      ),
      orders AS (
        -- Aggregate đơn hàng riêng theo campaign_name
        SELECT
          COALESCE(o.raw->>'p_utm_source', o.raw->>'p_utm_campaign') AS camp_name,
          COUNT(o.id)::int                                            AS total_orders,
          SUM(CASE WHEN o.status IN (1,2,3,4,5) THEN 1 ELSE 0 END)::int AS confirmed,
          SUM(CASE WHEN o.status IN (6,7,-1,-2) THEN 1 ELSE 0 END)::int AS cancelled,
          SUM(CASE WHEN o.status NOT IN (-2,7) THEN o.cod_amount ELSE 0 END)::bigint AS cod_total,
          SUM(CASE WHEN o.status IN (1,2,3,4,5) THEN o.cod_amount ELSE 0 END)::bigint AS cod_confirmed
        FROM pancake_order o
        WHERE o.deleted_at IS NULL
          AND o.source IN ('manual','webcake')
          AND NOT (o.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
          AND NOT (o.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
          AND o.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND o.pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND (o.raw->>'p_utm_source' IS NOT NULL OR o.raw->>'p_utm_campaign' IS NOT NULL)
        GROUP BY COALESCE(o.raw->>'p_utm_source', o.raw->>'p_utm_campaign')
      )
      SELECT
        a.campaign_id,
        a.campaign_name,
        a.mkt_name,
        a.spend,
        a.impressions,
        a.clicks,
        a.date_from,
        a.date_to,
        a.day_count,
        a.effective_status,
        a.daily_budget,
        CASE WHEN a.impressions > 0 THEN ROUND(a.spend::numeric / a.impressions * 1000, 0) ELSE NULL END AS cpm,
        CASE WHEN a.impressions > 0 THEN ROUND(a.clicks::numeric / a.impressions * 100, 2) ELSE NULL END AS ctr_pct,
        CASE WHEN a.clicks > 0 THEN ROUND(a.spend::numeric / a.clicks, 0) ELSE NULL END AS cpc,
        COALESCE(o.total_orders, 0)   AS total_orders,
        COALESCE(o.confirmed, 0)      AS confirmed,
        COALESCE(o.cancelled, 0)      AS cancelled,
        COALESCE(o.cod_total, 0)      AS cod_total,
        COALESCE(o.cod_confirmed, 0)  AS cod_confirmed,
        CASE WHEN COALESCE(o.cod_total, 0) > 0
          THEN ROUND(a.spend::numeric / o.cod_total * 100, 2)
          ELSE NULL
        END AS care_pct
      FROM ads a
      LEFT JOIN orders o ON o.camp_name = a.campaign_name
      ORDER BY a.spend DESC
    `, params)

    return res.json({ rows, from: fromDate, to: toDate, is_range: isRange, mkt: mkt || null })
  } catch (err: any) {
    console.error("[report/mkt-campaign]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
