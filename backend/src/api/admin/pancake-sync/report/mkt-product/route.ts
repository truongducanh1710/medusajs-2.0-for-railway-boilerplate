import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/mkt-product
 * ?from=2026-05-01&to=2026-05-27&mkt=KIENLB
 *
 * Chi phí theo SP từng MKT:
 * - Spend lấy từ mkt_ads_cost theo campaign
 * - Sản phẩm + đơn lấy từ pancake_order.items (tên SP thật từ POS)
 * - Join qua UTM matching (p_utm_source hoặc p_utm_campaign = campaign_name)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const q = req.query as Record<string, string>
    const fromDate = q.from ?? today
    const toDate = q.to ?? today
    const mkt = q.mkt ?? ""

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const rows = await cskhService.sql(`
      WITH camp_spend AS (
        SELECT campaign_name, mkt_name, SUM(spend)::bigint AS spend
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND date >= $1::date AND date <= $2::date
        GROUP BY campaign_name, mkt_name
      ),
      order_item_camp AS (
        SELECT
          upper(replace(trim(po.marketer_name), ' ', '')) AS mkt_name,
          item->>'name' AS item_name,
          CASE WHEN po.raw->>'p_utm_source' = 'fb'
            THEN po.raw->>'p_utm_campaign'
            ELSE po.raw->>'p_utm_source'
          END AS campaign_name,
          po.status,
          -- chia cod_amount đều cho số item trong đơn tránh double-count
          ROUND(po.cod_amount::numeric / NULLIF(jsonb_array_length(po.items), 0)) AS cod_amount
        FROM pancake_order po,
             jsonb_array_elements(COALESCE(po.items, '[]'::jsonb)) AS item
        WHERE po.deleted_at IS NULL
          AND po.source IN ('manual', 'webcake')
          AND NOT (po.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
          AND NOT (po.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
          AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.pancake_created_at <  (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND ($3 = '' OR upper(replace(trim(po.marketer_name), ' ', '')) = $3)
      ),
      order_agg AS (
        SELECT mkt_name, item_name,
          COUNT(*)::int AS total_orders,
          SUM(CASE WHEN status IN (1,2,3,4,5) THEN 1 ELSE 0 END)::int AS confirmed,
          SUM(CASE WHEN status IN (1,2,3,4,5) THEN cod_amount ELSE 0 END)::bigint AS cod_confirmed
        FROM order_item_camp
        GROUP BY mkt_name, item_name
      ),
      spend_agg AS (
        SELECT oic.mkt_name, oic.item_name, SUM(cs.spend)::bigint AS spend
        FROM (SELECT DISTINCT mkt_name, item_name, campaign_name FROM order_item_camp WHERE campaign_name IS NOT NULL) oic
        JOIN camp_spend cs ON cs.campaign_name = oic.campaign_name AND cs.mkt_name = oic.mkt_name
        GROUP BY oic.mkt_name, oic.item_name
      )
      SELECT
        o.mkt_name,
        o.item_name,
        COALESCE(s.spend, 0) AS spend,
        o.total_orders,
        o.confirmed AS don,
        CASE WHEN o.confirmed > 0 THEN COALESCE(s.spend,0) / o.confirmed ELSE 0 END AS chi_phi_don,
        o.cod_confirmed AS doanh_so,
        CASE WHEN o.cod_confirmed > 0
          THEN ROUND(COALESCE(s.spend,0)::numeric / o.cod_confirmed * 100, 1)
          ELSE NULL END AS pct_ads
      FROM order_agg o
      LEFT JOIN spend_agg s USING (mkt_name, item_name)
      ORDER BY o.mkt_name, COALESCE(s.spend,0) DESC
    `, [fromDate, toDate, mkt])

    return res.json({ rows, from: fromDate, to: toDate, mkt: mkt || null })
  } catch (err: any) {
    console.error("[report/mkt-product]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
