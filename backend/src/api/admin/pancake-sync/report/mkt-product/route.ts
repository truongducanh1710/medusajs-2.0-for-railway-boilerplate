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
      order_base AS (
        SELECT
          po.id AS order_id,
          upper(replace(trim(po.marketer_name), ' ', '')) AS mkt_name,
          CASE WHEN po.raw->>'p_utm_source' = 'fb'
            THEN po.raw->>'p_utm_campaign'
            ELSE po.raw->>'p_utm_source'
          END AS campaign_name,
          po.status,
          po.items
        FROM pancake_order po
        WHERE po.deleted_at IS NULL
          AND po.source IN ('manual', 'webcake')
          AND NOT (po.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
          AND NOT (po.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
          AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.pancake_created_at <  (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND ($3 = '' OR upper(replace(trim(po.marketer_name), ' ', '')) = $3)
      ),
      order_item AS (
        SELECT
          ob.mkt_name, ob.campaign_name, ob.status,
          item->>'name' AS item_name,
          COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'quantity')::numeric, 1) AS item_cod
        FROM order_base ob,
             jsonb_array_elements(COALESCE(ob.items, '[]'::jsonb)) AS item
      ),
      item_agg AS (
        SELECT mkt_name, item_name,
          COUNT(*)::int AS total_orders,
          SUM(CASE WHEN status IN (1,2,3,4,5) THEN 1 ELSE 0 END)::int AS confirmed,
          SUM(CASE WHEN status IN (1,2,3,4,5) THEN item_cod ELSE 0 END)::bigint AS cod_confirmed
        FROM order_item
        GROUP BY mkt_name, item_name
      ),
      camp_item_count AS (
        SELECT mkt_name, campaign_name, item_name, COUNT(*) AS cnt
        FROM order_item
        WHERE campaign_name IS NOT NULL AND status IN (1,2,3,4,5)
        GROUP BY mkt_name, campaign_name, item_name
      ),
      camp_main_item AS (
        SELECT DISTINCT ON (mkt_name, campaign_name)
          mkt_name, campaign_name, item_name
        FROM camp_item_count
        ORDER BY mkt_name, campaign_name, cnt DESC, item_name
      ),
      spend_per_item AS (
        SELECT cmi.mkt_name, cmi.item_name, SUM(cs.spend)::bigint AS spend
        FROM camp_main_item cmi
        JOIN camp_spend cs USING (mkt_name, campaign_name)
        GROUP BY cmi.mkt_name, cmi.item_name
      )
      SELECT
        ia.mkt_name, ia.item_name,
        COALESCE(sp.spend, 0) AS spend,
        ia.total_orders,
        ia.confirmed AS don,
        CASE WHEN ia.confirmed > 0 THEN COALESCE(sp.spend,0) / ia.confirmed ELSE 0 END AS chi_phi_don,
        ia.cod_confirmed AS doanh_so,
        CASE WHEN ia.cod_confirmed > 0
          THEN ROUND(COALESCE(sp.spend,0)::numeric / ia.cod_confirmed * 100, 1)
          ELSE NULL END AS pct_ads
      FROM item_agg ia
      LEFT JOIN spend_per_item sp USING (mkt_name, item_name)
      ORDER BY ia.mkt_name, COALESCE(sp.spend,0) DESC
    `, [fromDate, toDate, mkt])

    return res.json({ rows, from: fromDate, to: toDate, mkt: mkt || null })
  } catch (err: any) {
    console.error("[report/mkt-product]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
