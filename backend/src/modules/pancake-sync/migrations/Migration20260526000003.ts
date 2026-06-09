import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260526000003 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      -- v_camp_dashboard: "màn hình marketer" — 1 query đủ context để quyết định
      -- Giống hệt những gì người thấy trong bảng camp: tên, status, budget, spend hôm nay,
      -- %, CPM, CTR, COD hôm nay, care hôm nay, care_3d/7d, ngày chạy, trend signal
      CREATE OR REPLACE VIEW v_camp_dashboard AS
      WITH max_d AS (
        SELECT MAX(date) AS d FROM mkt_ads_cost WHERE deleted_at IS NULL
      ),
      today_ads AS (
        SELECT
          campaign_id, campaign_name, mkt_name, effective_status,
          daily_budget, spend, impressions, clicks,
          CASE WHEN impressions > 0 THEN ROUND(spend::numeric / impressions * 1000) END AS cpm,
          CASE WHEN clicks > 0    THEN ROUND(spend::numeric / clicks) END AS cpc,
          CASE WHEN impressions > 0 THEN ROUND(clicks::numeric / impressions * 100, 2) END AS ctr_pct,
          CASE WHEN daily_budget > 0 THEN ROUND(spend::numeric / daily_budget * 100) END AS spend_budget_pct
        FROM mkt_ads_cost, max_d
        WHERE date = max_d.d AND deleted_at IS NULL
      ),
      today_orders AS (
        SELECT
          utm_source AS campaign_name_key,
          COUNT(*) AS cod_orders_today,
          COALESCE(SUM(cod_amount), 0) AS cod_today
        FROM v_camp_orders, max_d
        WHERE date = max_d.d
        GROUP BY utm_source
      ),
      care_win AS (
        SELECT * FROM v_camp_care_window
      ),
      -- Tính ngày tạo camp (ngày đầu tiên xuất hiện trong mkt_ads_cost)
      camp_first_seen AS (
        SELECT campaign_id, MIN(date) AS first_date
        FROM mkt_ads_cost WHERE deleted_at IS NULL
        GROUP BY campaign_id
      ),
      -- 3d trend: care_3d so với care_7d để biết đang tốt lên hay xấu đi
      trend_signal AS (
        SELECT
          cw.campaign_id,
          CASE
            WHEN cw.care_3d IS NULL AND cw.care_7d IS NULL THEN 'no_data'
            WHEN cw.care_3d IS NULL THEN 'insufficient'
            WHEN cw.care_7d IS NULL THEN 'new_camp'
            WHEN cw.care_3d < 25 THEN 'great'
            WHEN cw.care_3d < 30 THEN 'ok'
            WHEN cw.care_3d < 40 AND cw.care_3d < cw.care_7d THEN 'improving'
            WHEN cw.care_3d >= 40 AND cw.care_3d > cw.care_7d THEN 'worsening'
            WHEN cw.care_3d >= 30 THEN 'high_care'
            ELSE 'stable'
          END AS trend
        FROM care_win cw
      )
      SELECT
        t.campaign_id,
        t.campaign_name,
        t.mkt_name,
        t.effective_status,
        -- Budget & spend hôm nay
        t.daily_budget,
        t.spend AS spend_today,
        t.spend_budget_pct,       -- vd: 46 → tiêu 46% budget
        t.impressions,
        t.clicks,
        t.cpm,
        t.cpc,
        t.ctr_pct,
        -- COD hôm nay (khớp theo utm_source = campaign_name)
        COALESCE(o.cod_orders_today, 0) AS cod_orders_today,
        COALESCE(o.cod_today, 0) AS cod_today,
        CASE
          WHEN o.cod_today > 0 THEN ROUND(t.spend::numeric / o.cod_today * 100, 1)
        END AS care_today,
        -- Care windows
        cw.care_3d,
        cw.care_7d,
        cw.care_14d,
        cw.spend_3d,
        cw.cod_3d,
        cw.spend_7d,
        cw.cod_7d,
        -- Tuổi camp (marketer biết camp mới bao nhiêu ngày)
        (SELECT max_d.d FROM max_d) - fs.first_date AS days_running,
        -- Signal tổng hợp để agent filter nhanh
        ts.trend,
        -- Flag có đơn hôm nay không
        (COALESCE(o.cod_orders_today, 0) > 0) AS has_orders_today,
        -- Flag đang tiêu gần hết budget
        (t.spend_budget_pct >= 80) AS budget_nearly_exhausted
      FROM today_ads t
      LEFT JOIN today_orders o    ON o.campaign_name_key = t.campaign_name
      LEFT JOIN care_win cw       ON cw.campaign_id = t.campaign_id
      LEFT JOIN camp_first_seen fs ON fs.campaign_id = t.campaign_id
      LEFT JOIN trend_signal ts   ON ts.campaign_id = t.campaign_id;


      -- v_camp_daily_trend: lịch sử 14 ngày per camp per day
      -- Agent dùng để "cuộn xuống xem chi tiết" — như marketer click vào camp xem graph
      CREATE OR REPLACE VIEW v_camp_daily_trend AS
      WITH max_d AS (
        SELECT MAX(date) AS d FROM mkt_ads_cost WHERE deleted_at IS NULL
      ),
      daily_orders AS (
        SELECT
          utm_source AS campaign_name_key,
          date,
          COUNT(*) AS cod_orders,
          COALESCE(SUM(cod_amount), 0) AS cod_amount
        FROM v_camp_orders, max_d
        WHERE date >= max_d.d - 13
        GROUP BY utm_source, date
      )
      SELECT
        mac.campaign_id,
        mac.campaign_name,
        mac.mkt_name,
        mac.date,
        mac.effective_status,
        mac.daily_budget,
        mac.spend,
        mac.impressions,
        mac.clicks,
        CASE WHEN mac.impressions > 0 THEN ROUND(mac.spend::numeric / mac.impressions * 1000) END AS cpm,
        CASE WHEN mac.clicks > 0 THEN ROUND(mac.spend::numeric / mac.clicks) END AS cpc,
        COALESCE(do2.cod_orders, 0) AS cod_orders,
        COALESCE(do2.cod_amount, 0) AS cod_amount,
        CASE
          WHEN COALESCE(do2.cod_amount, 0) > 0
          THEN ROUND(mac.spend::numeric / do2.cod_amount * 100, 1)
        END AS care_pct
      FROM mkt_ads_cost mac
      CROSS JOIN max_d
      LEFT JOIN daily_orders do2
        ON do2.campaign_name_key = mac.campaign_name AND do2.date = mac.date
      WHERE mac.deleted_at IS NULL
        AND mac.date >= max_d.d - 13
      ORDER BY mac.campaign_id, mac.date DESC;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP VIEW IF EXISTS v_camp_daily_trend;
      DROP VIEW IF EXISTS v_camp_dashboard;
    `)
  }
}
