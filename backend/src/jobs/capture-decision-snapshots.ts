import { MedusaContainer } from "@medusajs/framework"

/**
 * Job mỗi 15p: capture snapshot AFTER cho recommendations đến hạn
 * - after_4h: chụp khi rec đã đủ 4h tuổi
 * - after_eod: chụp khi đã sang ngày mới (so với rec)
 */
export default async function captureDecisionSnapshots(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const sql = container.resolve("cskhAnalysisModule") as any

  try {
    // 1. AFTER_4H — recs tạo cách đây 4-5h, chưa có snapshot after_4h
    const recs4h = await sql.sql(`
      SELECT r.id, r.run_id, r.campaign_id, r.created_at
      FROM agent_camp_recommendation r
      WHERE r.created_at < now() - interval '4 hours'
        AND r.created_at > now() - interval '5 hours'
        AND NOT EXISTS (
          SELECT 1 FROM agent_decision_snapshot s
          WHERE s.rec_id = r.id AND s.snapshot_type = 'after_4h'
        )
      LIMIT 200
    `).catch(() => [])

    let count4h = 0
    for (const r of recs4h) {
      await sql.sql(
        `INSERT INTO agent_decision_snapshot
           (rec_id, run_id, campaign_id, snapshot_type,
            spend, impressions, clicks, cod_orders, cod_amount,
            care_pct, cpm, ctr_pct, effective_status, daily_budget,
            shop_care_pct, shop_cod)
         SELECT $1, $2, $3, 'after_4h',
           c.spend_today, c.impressions, c.clicks, c.cod_orders_today, c.cod_today,
           c.care_today, c.cpm, c.ctr_pct, c.effective_status, c.daily_budget,
           s.care_pct, s.total_cod
         FROM v_camp_dashboard c
         CROSS JOIN (SELECT care_pct, total_cod FROM v_shop_care_daily ORDER BY date DESC LIMIT 1) s
         WHERE c.campaign_id = $3
         ON CONFLICT (rec_id, snapshot_type) DO NOTHING`,
        [r.id, r.run_id, r.campaign_id]
      ).catch(() => {})
      count4h++
    }

    // 2. AFTER_EOD — recs tạo hôm qua (theo giờ VN), chưa có snapshot after_eod
    // VN date = UTC+7
    const recsEod = await sql.sql(`
      SELECT r.id, r.run_id, r.campaign_id, r.created_at,
             ((r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS rec_date
      FROM agent_camp_recommendation r
      WHERE ((r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
            < ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        AND r.created_at > now() - interval '36 hours'
        AND NOT EXISTS (
          SELECT 1 FROM agent_decision_snapshot s
          WHERE s.rec_id = r.id AND s.snapshot_type = 'after_eod'
        )
      LIMIT 500
    `).catch(() => [])

    let countEod = 0
    for (const r of recsEod) {
      // Lấy EOD metrics từ mkt_ads_cost ngày của rec (rec_date)
      await sql.sql(
        `INSERT INTO agent_decision_snapshot
           (rec_id, run_id, campaign_id, snapshot_type,
            spend, impressions, clicks, cod_orders, cod_amount,
            care_pct, cpm, ctr_pct, effective_status, daily_budget,
            shop_care_pct, shop_cod)
         SELECT $1, $2, $3, 'after_eod',
           m.spend, m.impressions, m.clicks,
           COALESCE(o.cod_orders, 0), COALESCE(o.cod_amount, 0),
           CASE WHEN COALESCE(o.cod_amount,0) > 0
                THEN ROUND(m.spend::numeric / o.cod_amount * 100, 1) ELSE NULL END,
           CASE WHEN m.impressions > 0 THEN ROUND(m.spend::numeric / m.impressions * 1000) END,
           CASE WHEN m.impressions > 0 THEN ROUND(m.clicks::numeric / m.impressions * 100, 2) END,
           m.effective_status, m.daily_budget,
           s.care_pct, s.total_cod
         FROM mkt_ads_cost m
         LEFT JOIN (
           SELECT utm_source AS cn,
                  COUNT(*) AS cod_orders,
                  COALESCE(SUM(cod_amount), 0) AS cod_amount
           FROM v_camp_orders
           WHERE order_date = $4::date
           GROUP BY utm_source
         ) o ON o.cn = m.campaign_name
         CROSS JOIN (
           SELECT care_pct, total_cod FROM v_shop_care_daily WHERE date = $4::date LIMIT 1
         ) s
         WHERE m.campaign_id = $3 AND m.date = $4::date AND m.deleted_at IS NULL
         ON CONFLICT (rec_id, snapshot_type) DO NOTHING`,
        [r.id, r.run_id, r.campaign_id, r.rec_date]
      ).catch(() => {})
      countEod++
    }

    logger?.info?.(`[DecisionSnap] captured ${count4h} after_4h + ${countEod} after_eod`)
  } catch (e: any) {
    logger?.error?.("[DecisionSnap] error:", e.message)
  }
}

export const config = {
  name: "capture-decision-snapshots",
  schedule: "*/15 * * * *",  // mỗi 15 phút
}
