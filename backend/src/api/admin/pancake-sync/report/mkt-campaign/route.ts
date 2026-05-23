import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/mkt-campaign?from=2026-05-01&to=2026-05-31&mkt=KIENLB
 * Báo cáo chi phí theo từng campaign FB Ads — so với COD đơn hàng matched qua p_utm_campaign.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      mkt,
    } = req.query as Record<string, string>

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const params: any[] = [`${from}`, to]
    const mktFilter = mkt ? `AND c.mkt_name = $3` : ""
    if (mkt) params.push(mkt)

    const rows = await cskhService.sql(`
      SELECT
        c.campaign_id,
        c.campaign_name,
        c.mkt_name,
        SUM(c.spend)::bigint AS spend,
        SUM(c.impressions)::int AS impressions,
        SUM(c.clicks)::int AS clicks,
        COUNT(DISTINCT o.id)::int AS total_orders,
        SUM(CASE WHEN o.status = 3 THEN o.cod_amount ELSE 0 END)::bigint AS cod_delivered,
        SUM(CASE WHEN o.status NOT IN (-2, 7) THEN o.cod_amount ELSE 0 END)::bigint AS cod_total,
        SUM(CASE WHEN o.status IN (6, 7, -1, -2) THEN 1 ELSE 0 END)::int AS cancelled,
        SUM(CASE WHEN o.status = 3 THEN 1 ELSE 0 END)::int AS delivered,
        CASE
          WHEN SUM(CASE WHEN o.status NOT IN (-2, 7) THEN o.cod_amount ELSE 0 END) > 0
          THEN ROUND(SUM(c.spend)::numeric / SUM(CASE WHEN o.status NOT IN (-2, 7) THEN o.cod_amount ELSE 0 END) * 100, 2)
          ELSE NULL
        END AS care_pct
      FROM mkt_ads_cost c
      LEFT JOIN pancake_order o
        ON o.deleted_at IS NULL
        AND o.source IN ('manual', 'webcake')
        AND NOT (o.tags @> '[{"name": "Đơn nháp"}]'::jsonb)
        AND o.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND o.pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND o.raw->>'p_utm_campaign' ILIKE '%' || c.campaign_name || '%'
      WHERE c.deleted_at IS NULL
        AND c.date >= $1::date AND c.date <= $2::date
        ${mktFilter}
      GROUP BY c.campaign_id, c.campaign_name, c.mkt_name
      ORDER BY SUM(c.spend) DESC
    `, params)

    // Summary per MKT
    const summary: Record<string, { spend: number; cod_total: number; cod_delivered: number; total_orders: number; care_pct: number | null }> = {}
    for (const row of rows) {
      const m = row.mkt_name || "KHÁC"
      if (!summary[m]) summary[m] = { spend: 0, cod_total: 0, cod_delivered: 0, total_orders: 0, care_pct: null }
      summary[m].spend += Number(row.spend)
      summary[m].cod_total += Number(row.cod_total)
      summary[m].cod_delivered += Number(row.cod_delivered)
      summary[m].total_orders += Number(row.total_orders)
    }
    for (const m of Object.keys(summary)) {
      const s = summary[m]
      s.care_pct = s.cod_total > 0 ? Math.round(s.spend / s.cod_total * 10000) / 100 : null
    }

    return res.json({ rows, summary, from, to, mkt: mkt || null })
  } catch (err: any) {
    console.error("[report/mkt-campaign]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
