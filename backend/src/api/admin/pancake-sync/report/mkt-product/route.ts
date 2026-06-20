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
        SELECT campaign_name, mkt_name,
          SUM(spend)::bigint AS spend
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND date >= $1::date AND date <= $2::date
          AND ($3 = '' OR mkt_name = $3)
        GROUP BY campaign_name, mkt_name
      ),
      -- Cách 1: lấy mã SP ở đầu tên camp (MÃSP_DD/MM_MKT_..., vd PHVVN031BCX) rồi join mkt_product
      -- để ra tên SP thật (nguồn DB, không dùng dictionary cứng) — ưu tiên mã SP, KHÔNG dùng
      -- đoạn text tên SP tự do trong tên camp (có thể đặt cũ/sai khi đổi SP mà không sửa tên camp)
      camp_product_from_name AS (
        SELECT cs.campaign_name, cs.mkt_name, cs.spend, mp.name AS item_name_from_camp
        FROM camp_spend cs
        LEFT JOIN mkt_product mp
          ON mp.active = true
          AND upper(mp.code) = upper(split_part(cs.campaign_name, '_', 1))
      ),
      -- Cách 2 (fallback khi camp không theo convention): suy SP thật từ đơn đã match UTM
      -- (không giới hạn theo khoảng ngày đang xem báo cáo — camp có thể có đơn ở ngày khác)
      camp_order_item AS (
        SELECT
          CASE WHEN po.raw->>'p_utm_source' = 'fb'
            THEN po.raw->>'p_utm_campaign'
            ELSE po.raw->>'p_utm_source'
          END AS campaign_name,
          item->>'name' AS item_name
        FROM pancake_order po,
             jsonb_array_elements(COALESCE(po.items, '[]'::jsonb)) AS item
        WHERE po.deleted_at IS NULL
          AND po.source IN ('manual', 'webcake')
          AND NOT (po.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
          AND NOT (po.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
          AND po.pancake_created_at >= (now() - interval '365 days')
      ),
      camp_product AS (
        SELECT DISTINCT ON (campaign_name) campaign_name, item_name
        FROM (
          SELECT campaign_name, item_name, COUNT(*) AS cnt
          FROM camp_order_item
          WHERE campaign_name IS NOT NULL
          GROUP BY campaign_name, item_name
        ) t
        ORDER BY campaign_name, cnt DESC
      ),
      spend_per_sku AS (
        SELECT cpn.mkt_name,
          COALESCE(cpn.item_name_from_camp, cp.item_name, 'CHƯA RÕ SP (camp chưa có đơn match)') AS item_name,
          SUM(cpn.spend)::bigint AS spend
        FROM camp_product_from_name cpn
        LEFT JOIN camp_product cp ON cp.campaign_name = cpn.campaign_name
        GROUP BY cpn.mkt_name, COALESCE(cpn.item_name_from_camp, cp.item_name, 'CHƯA RÕ SP (camp chưa có đơn match)')
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
          SUM(CASE WHEN status NOT IN (-2,7) THEN 1 ELSE 0 END)::int AS confirmed,
          SUM(CASE WHEN status NOT IN (-2,7) THEN item_cod ELSE 0 END)::bigint AS cod_confirmed
        FROM order_item
        GROUP BY mkt_name, item_name
      ),
      combined AS (
        SELECT
          COALESCE(ss.mkt_name, ia.mkt_name) AS mkt_name,
          COALESCE(ss.item_name, ia.item_name) AS item_name,
          COALESCE(ss.spend, 0) AS spend,
          COALESCE(ia.total_orders, 0) AS total_orders,
          COALESCE(ia.confirmed, 0) AS don,
          COALESCE(ia.cod_confirmed, 0) AS doanh_so
        FROM spend_per_sku ss
        FULL OUTER JOIN item_agg ia USING (mkt_name, item_name)
      )
      SELECT
        mkt_name, item_name, spend, total_orders, don,
        CASE WHEN don > 0 THEN spend / don ELSE 0 END AS chi_phi_don,
        doanh_so,
        CASE WHEN doanh_so > 0
          THEN ROUND(spend::numeric / doanh_so * 100, 1)
          ELSE NULL END AS pct_ads
      FROM combined
      ORDER BY mkt_name, spend DESC
    `, [fromDate, toDate, mkt])

    return res.json({ rows, from: fromDate, to: toDate, mkt: mkt || null })
  } catch (err: any) {
    console.error("[report/mkt-product]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
