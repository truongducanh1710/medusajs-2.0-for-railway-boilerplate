import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/mkt-ad
 * ?from=2026-07-15&to=2026-07-22   — khoảng ngày, GROUP BY ad_id
 * ?date=2026-07-22                 — 1 ngày
 * &level=ad|adset                  — mặc định ad
 * &mkt=KIENLB &campaign_id= &vd_code= &q=  — filter
 *
 * Đọc từ mkt_ads_cost_ad / mkt_ads_cost_adset (đã sync sẵn), KHÔNG gọi FB real-time.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
    const q = req.query as Record<string, string>
    const level = q.level === "adset" ? "adset" : "ad"

    const fromDate = q.from ?? q.date ?? today
    const toDate = q.to ?? q.date ?? today

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const params: any[] = [fromDate, toDate]
    const filters: string[] = []
    const push = (val: any, clause: (p: string) => string) => {
      params.push(val)
      filters.push(clause(`$${params.length}`))
    }

    if (q.mkt) push(q.mkt, (p) => `mkt_name = ${p}`)
    if (q.campaign_id) push(q.campaign_id, (p) => `campaign_id = ${p}`)
    if (q.account_id) {
      push(q.account_id.startsWith("act_") ? q.account_id : `act_${q.account_id}`, (p) => `ad_account_id = ${p}`)
    }
    if (level === "ad" && q.vd_code) push(q.vd_code.toUpperCase(), (p) => `vd_code = ${p}`)
    if (q.q) {
      const nameCol = level === "ad" ? "ad_name" : "adset_name"
      push(`%${q.q}%`, (p) => `(${nameCol} ILIKE ${p} OR campaign_name ILIKE ${p})`)
    }

    const where = filters.length ? `AND ${filters.join(" AND ")}` : ""

    // adset và ad khác nhau ở cột định danh + vd_code (chỉ ad có)
    const rows = level === "ad"
      ? await cskhService.sql(`
          SELECT
            ad_id,
            (ARRAY_AGG(ad_name       ORDER BY date DESC))[1] AS ad_name,
            (ARRAY_AGG(vd_code       ORDER BY date DESC))[1] AS vd_code,
            (ARRAY_AGG(adset_id      ORDER BY date DESC))[1] AS adset_id,
            (ARRAY_AGG(adset_name    ORDER BY date DESC))[1] AS adset_name,
            (ARRAY_AGG(campaign_id   ORDER BY date DESC))[1] AS campaign_id,
            (ARRAY_AGG(campaign_name ORDER BY date DESC))[1] AS campaign_name,
            (ARRAY_AGG(mkt_name      ORDER BY date DESC))[1] AS mkt_name,
            SUM(spend)::bigint      AS spend,
            SUM(impressions)::int   AS impressions,
            SUM(clicks)::int        AS clicks,
            MIN(date)::date         AS date_from,
            MAX(date)::date         AS date_to,
            COUNT(DISTINCT date)::int AS day_count,
            CASE WHEN SUM(impressions) > 0
              THEN ROUND(SUM(spend)::numeric / SUM(impressions) * 1000) END AS cpm,
            CASE WHEN SUM(impressions) > 0
              THEN ROUND(SUM(clicks)::numeric / SUM(impressions) * 100, 2) END AS ctr_pct,
            CASE WHEN SUM(clicks) > 0
              THEN ROUND(SUM(spend)::numeric / SUM(clicks)) END AS cpc
          FROM mkt_ads_cost_ad
          WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date ${where}
          GROUP BY ad_id
          ORDER BY spend DESC
          LIMIT 500
        `, params)
      : await cskhService.sql(`
          SELECT
            adset_id,
            (ARRAY_AGG(adset_name    ORDER BY date DESC))[1] AS adset_name,
            (ARRAY_AGG(campaign_id   ORDER BY date DESC))[1] AS campaign_id,
            (ARRAY_AGG(campaign_name ORDER BY date DESC))[1] AS campaign_name,
            (ARRAY_AGG(mkt_name      ORDER BY date DESC))[1] AS mkt_name,
            SUM(spend)::bigint      AS spend,
            SUM(impressions)::int   AS impressions,
            SUM(clicks)::int        AS clicks,
            MIN(date)::date         AS date_from,
            MAX(date)::date         AS date_to,
            COUNT(DISTINCT date)::int AS day_count,
            CASE WHEN SUM(impressions) > 0
              THEN ROUND(SUM(spend)::numeric / SUM(impressions) * 1000) END AS cpm,
            CASE WHEN SUM(impressions) > 0
              THEN ROUND(SUM(clicks)::numeric / SUM(impressions) * 100, 2) END AS ctr_pct,
            CASE WHEN SUM(clicks) > 0
              THEN ROUND(SUM(spend)::numeric / SUM(clicks)) END AS cpc
          FROM mkt_ads_cost_adset
          WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date ${where}
          GROUP BY adset_id
          ORDER BY spend DESC
          LIMIT 500
        `, params)

    return res.json({ rows, from: fromDate, to: toDate, level, mkt: q.mkt || null })
  } catch (err: any) {
    console.error("[report/mkt-ad]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
