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
      SELECT
        c.campaign_id,
        c.campaign_name,
        c.mkt_name,
        -- Tổng cộng cả kỳ
        SUM(c.spend)::bigint                          AS spend,
        SUM(c.impressions)::int                       AS impressions,
        SUM(c.clicks)::int                            AS clicks,
        -- Ngày đầu + cuối trong kỳ để hiển thị
        MIN(c.date)::date                             AS date_from,
        MAX(c.date)::date                             AS date_to,
        COUNT(DISTINCT c.date)::int                   AS day_count,
        -- Lấy status + budget của ngày gần nhất
        (ARRAY_AGG(c.effective_status ORDER BY c.date DESC))[1] AS effective_status,
        (ARRAY_AGG(c.daily_budget     ORDER BY c.date DESC))[1]::bigint AS daily_budget,
        -- CPM / CTR tính từ tổng
        CASE WHEN SUM(c.impressions) > 0
          THEN ROUND(SUM(c.spend)::numeric / SUM(c.impressions) * 1000, 0)
          ELSE NULL END                               AS cpm,
        CASE WHEN SUM(c.clicks) > 0 AND SUM(c.impressions) > 0
          THEN ROUND(SUM(c.clicks)::numeric / SUM(c.impressions) * 100, 2)
          ELSE NULL END                               AS ctr_pct,
        CASE WHEN SUM(c.clicks) > 0
          THEN ROUND(SUM(c.spend)::numeric / SUM(c.clicks), 0)
          ELSE NULL END                               AS cpc,
        -- Đơn hàng trong cùng kỳ
        COUNT(o.id)::int                              AS total_orders,
        SUM(CASE WHEN o.status = 3 THEN 1 ELSE 0 END)::int         AS delivered,
        SUM(CASE WHEN o.status IN (6,7,-1,-2) THEN 1 ELSE 0 END)::int AS cancelled,
        SUM(CASE WHEN o.status NOT IN (-2,7) THEN o.cod_amount ELSE 0 END)::bigint AS cod_total,
        SUM(CASE WHEN o.status = 3 THEN o.cod_amount ELSE 0 END)::bigint          AS cod_delivered,
        CASE
          WHEN SUM(CASE WHEN o.status NOT IN (-2,7) THEN o.cod_amount ELSE 0 END) > 0
          THEN ROUND(SUM(c.spend)::numeric / SUM(CASE WHEN o.status NOT IN (-2,7) THEN o.cod_amount ELSE 0 END) * 100, 2)
          ELSE NULL
        END                                           AS care_pct
      FROM mkt_ads_cost c
      LEFT JOIN pancake_order o
        ON o.deleted_at IS NULL
        AND o.source IN ('manual','webcake')
        AND NOT (o.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
        AND NOT (o.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
        AND o.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND o.pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND (o.raw->>'p_utm_source' = c.campaign_name OR o.raw->>'p_utm_campaign' = c.campaign_name)
      WHERE c.deleted_at IS NULL
        AND c.date >= $1::date
        AND c.date <= $2::date
        ${mktFilter}
      GROUP BY c.campaign_id, c.campaign_name, c.mkt_name
      ORDER BY SUM(c.spend) DESC
    `, params)

    return res.json({ rows, from: fromDate, to: toDate, is_range: isRange, mkt: mkt || null })
  } catch (err: any) {
    console.error("[report/mkt-campaign]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
