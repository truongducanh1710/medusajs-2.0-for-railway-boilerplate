import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const excludedOrderFilter = `
  deleted_at IS NULL
  AND source IN ('manual','webcake','facebook','medusa')
  AND NOT (tags @> '[{"name":"Đơn nháp"}]'::jsonb)
  AND NOT (tags @> '[{"name":"Đơn trùng"}]'::jsonb)
`

/**
 * GET /admin/pancake-sync/report/campaign-orders?campaign_id=&from=&to=&include_utm_mismatch=true
 * Orders attributed to a campaign by campaign id first, then by UTM campaign/source name.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { campaign_id, from, to, include_utm_mismatch = "false", limit = "100" } = req.query as Record<string, string>
    if (!campaign_id || !from || !to) return res.status(400).json({ error: "campaign_id, from, to are required" })
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 200)
    const sql = req.scope.resolve("cskhAnalysisModule") as any

    const campRows = await sql.sql(`
      SELECT campaign_id, campaign_name, mkt_name, ad_account_id
      FROM mkt_ads_cost
      WHERE campaign_id = $1 AND deleted_at IS NULL
      ORDER BY date DESC
      LIMIT 1
    `, [campaign_id])
    if (!campRows.length) return res.status(404).json({ error: "Campaign not found in mkt_ads_cost" })
    const camp = campRows[0]

    const rows = await sql.sql(`
      SELECT
        id, source, status, status_name, customer_name, customer_phone,
        total, cod_amount, items, marketer_name, sale_name, care_name,
        fb_campaign_id,
        raw->>'p_utm_source' AS p_utm_source,
        raw->>'p_utm_campaign' AS p_utm_campaign,
        raw->>'p_utm_content' AS p_utm_content,
        pancake_created_at,
        CASE
          WHEN fb_campaign_id = $1 THEN 'campaign_id'
          WHEN raw->>'p_utm_campaign' = $2 THEN 'utm_campaign_name'
          WHEN raw->>'p_utm_source' = $2 THEN 'utm_source_name'
          ELSE 'possible_mismatch'
        END AS attribution_match
      FROM pancake_order
      WHERE ${excludedOrderFilter}
        AND pancake_created_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($4::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND (
          fb_campaign_id = $1
          OR raw->>'p_utm_campaign' = $2
          OR raw->>'p_utm_source' = $2
          OR (
            $5::boolean
            AND marketer_name = $6
            AND (
              raw->>'p_utm_campaign' ILIKE '%' || split_part($2, '_', 1) || '%'
              OR raw->>'p_utm_source' ILIKE '%' || split_part($2, '_', 1) || '%'
              OR raw::text ILIKE '%' || $1 || '%'
            )
          )
        )
      ORDER BY pancake_created_at DESC
      LIMIT $7
    `, [campaign_id, camp.campaign_name, from, to, include_utm_mismatch === "true", camp.mkt_name, lim])

    const summary = rows.reduce((acc: any, r: any) => {
      acc.total_orders += 1
      acc.cod_total += Number(r.cod_amount ?? 0)
      if ([1, 2, 3, 4, 5].includes(Number(r.status))) {
        acc.confirmed += 1
        acc.cod_confirmed += Number(r.cod_amount ?? 0)
      }
      return acc
    }, { total_orders: 0, confirmed: 0, cod_total: 0, cod_confirmed: 0 })

    return res.json({ campaign: camp, rows, summary, from, to })
  } catch (err: any) {
    console.error("[campaign-orders]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
