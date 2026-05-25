import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260526000004 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      -- v_mkt_daily: per MKT × per day — hiệu suất từng người theo ngày
      -- Agent dùng để thấy "LINHMT tuần này care bao nhiêu, trend như thế nào"
      CREATE OR REPLACE VIEW v_mkt_daily AS
      WITH ads AS (
        SELECT
          mkt_name,
          date,
          SUM(spend)::bigint AS spend,
          COUNT(DISTINCT campaign_id) AS active_camps
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND date >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 90
        GROUP BY mkt_name, date
      ),
      orders AS (
        SELECT
          -- Gán MKT từ utm_source: tên camp chứa _MKTCODE_
          -- Pattern: DD/MM_MKTCODE_PRODUCT hoặc DDMM_MKTCODE_...
          UPPER(TRIM(SPLIT_PART(
            REGEXP_REPLACE(utm_source, '^[0-9/]+_', ''),
            '_', 1
          ))) AS mkt_name,
          date,
          COUNT(*) AS order_count,
          COALESCE(SUM(cod_amount), 0)::bigint AS cod_amount
        FROM v_camp_orders
        WHERE utm_source IS NOT NULL
        GROUP BY 1, 2
      )
      SELECT
        a.mkt_name,
        a.date,
        a.spend,
        a.active_camps,
        COALESCE(o.order_count, 0) AS order_count,
        COALESCE(o.cod_amount, 0) AS cod_amount,
        CASE
          WHEN COALESCE(o.cod_amount, 0) > 0
          THEN ROUND(a.spend::numeric / o.cod_amount * 100, 1)
        END AS care_pct,
        -- So sánh với ngày trước (lag)
        LAG(CASE WHEN COALESCE(o.cod_amount,0) > 0
              THEN ROUND(a.spend::numeric / o.cod_amount * 100, 1) END)
          OVER (PARTITION BY a.mkt_name ORDER BY a.date) AS care_pct_prev_day
      FROM ads a
      LEFT JOIN orders o ON o.mkt_name = a.mkt_name AND o.date = a.date
      ORDER BY a.mkt_name, a.date DESC;


      -- v_mkt_summary: tổng hợp per MKT — care 3d/7d/30d, rank, trend
      -- Agent dùng để "ai đang kéo care lên, ai đang tốt, so sánh team"
      CREATE OR REPLACE VIEW v_mkt_summary AS
      WITH max_d AS (
        SELECT MAX(date) AS d FROM mkt_ads_cost WHERE deleted_at IS NULL
      ),
      mkt_windows AS (
        SELECT
          a.mkt_name,
          -- 3 ngày
          SUM(a.spend) FILTER (WHERE a.date >= (SELECT d FROM max_d) - 2)::bigint AS spend_3d,
          COALESCE(SUM(o.cod_amount) FILTER (WHERE o.date >= (SELECT d FROM max_d) - 2), 0)::bigint AS cod_3d,
          COALESCE(SUM(o.order_count) FILTER (WHERE o.date >= (SELECT d FROM max_d) - 2), 0) AS orders_3d,
          -- 7 ngày
          SUM(a.spend) FILTER (WHERE a.date >= (SELECT d FROM max_d) - 6)::bigint AS spend_7d,
          COALESCE(SUM(o.cod_amount) FILTER (WHERE o.date >= (SELECT d FROM max_d) - 6), 0)::bigint AS cod_7d,
          COALESCE(SUM(o.order_count) FILTER (WHERE o.date >= (SELECT d FROM max_d) - 6), 0) AS orders_7d,
          -- 30 ngày
          SUM(a.spend) FILTER (WHERE a.date >= (SELECT d FROM max_d) - 29)::bigint AS spend_30d,
          COALESCE(SUM(o.cod_amount) FILTER (WHERE o.date >= (SELECT d FROM max_d) - 29), 0)::bigint AS cod_30d,
          COALESCE(SUM(o.order_count) FILTER (WHERE o.date >= (SELECT d FROM max_d) - 29), 0) AS orders_30d,
          -- Tháng này (calendar month)
          SUM(a.spend) FILTER (WHERE DATE_TRUNC('month', a.date) = DATE_TRUNC('month', (SELECT d FROM max_d)))::bigint AS spend_mtd,
          COALESCE(SUM(o.cod_amount) FILTER (WHERE DATE_TRUNC('month', o.date) = DATE_TRUNC('month', (SELECT d FROM max_d))), 0)::bigint AS cod_mtd,
          -- Tuần này (Mon-Sun)
          SUM(a.spend) FILTER (WHERE a.date >= DATE_TRUNC('week', (SELECT d FROM max_d)))::bigint AS spend_wtd,
          COALESCE(SUM(o.cod_amount) FILTER (WHERE o.date >= DATE_TRUNC('week', (SELECT d FROM max_d))), 0)::bigint AS cod_wtd,
          -- Active camps hôm nay
          COUNT(DISTINCT a.campaign_id) FILTER (WHERE a.date = (SELECT d FROM max_d)) AS active_camps_today
        FROM mkt_ads_cost a
        LEFT JOIN (
          SELECT
            UPPER(TRIM(SPLIT_PART(REGEXP_REPLACE(utm_source, '^[0-9/]+_', ''), '_', 1))) AS mkt_name,
            date,
            COUNT(*) AS order_count,
            SUM(cod_amount) AS cod_amount
          FROM v_camp_orders WHERE utm_source IS NOT NULL
          GROUP BY 1, 2
        ) o ON o.mkt_name = a.mkt_name AND o.date = a.date
        WHERE a.deleted_at IS NULL
          AND a.date >= (SELECT d FROM max_d) - 29
        GROUP BY a.mkt_name
      )
      SELECT
        mw.mkt_name,
        -- Care per window
        CASE WHEN mw.cod_3d  > 0 THEN ROUND(mw.spend_3d::numeric  / mw.cod_3d  * 100, 1) END AS care_3d,
        CASE WHEN mw.cod_7d  > 0 THEN ROUND(mw.spend_7d::numeric  / mw.cod_7d  * 100, 1) END AS care_7d,
        CASE WHEN mw.cod_30d > 0 THEN ROUND(mw.spend_30d::numeric / mw.cod_30d * 100, 1) END AS care_30d,
        CASE WHEN mw.cod_mtd > 0 THEN ROUND(mw.spend_mtd::numeric / mw.cod_mtd * 100, 1) END AS care_mtd,
        CASE WHEN mw.cod_wtd > 0 THEN ROUND(mw.spend_wtd::numeric / mw.cod_wtd * 100, 1) END AS care_wtd,
        -- Volume
        mw.spend_7d, mw.cod_7d, mw.orders_7d,
        mw.spend_30d, mw.cod_30d, mw.orders_30d,
        mw.spend_mtd, mw.cod_mtd,
        mw.spend_wtd, mw.cod_wtd,
        mw.active_camps_today,
        -- Trend: care_3d vs care_7d
        CASE
          WHEN mw.cod_3d = 0 OR mw.cod_7d = 0 THEN 'no_data'
          WHEN ROUND(mw.spend_3d::numeric/mw.cod_3d*100,1) < 25 THEN 'great'
          WHEN ROUND(mw.spend_3d::numeric/mw.cod_3d*100,1) < 30 THEN 'ok'
          WHEN ROUND(mw.spend_3d::numeric/mw.cod_3d*100,1) <
               ROUND(mw.spend_7d::numeric/mw.cod_7d*100,1) - 3 THEN 'improving'
          WHEN ROUND(mw.spend_3d::numeric/mw.cod_3d*100,1) >
               ROUND(mw.spend_7d::numeric/mw.cod_7d*100,1) + 3 THEN 'worsening'
          ELSE 'stable'
        END AS trend_3v7,
        -- Rank trong team theo care_7d (1 = tốt nhất)
        RANK() OVER (ORDER BY
          CASE WHEN mw.cod_7d > 0 THEN mw.spend_7d::numeric/mw.cod_7d END ASC NULLS LAST
        ) AS care_rank_7d,
        -- Đóng góp % spend và % cod toàn team
        ROUND(mw.spend_7d::numeric / NULLIF(SUM(mw.spend_7d) OVER (), 0) * 100, 1) AS spend_share_pct,
        ROUND(mw.cod_7d::numeric   / NULLIF(SUM(mw.cod_7d)   OVER (), 0) * 100, 1) AS cod_share_pct
      FROM mkt_windows mw
      ORDER BY care_rank_7d;


      -- v_shop_weekly: care toàn shop theo tuần — big picture context
      CREATE OR REPLACE VIEW v_shop_weekly AS
      WITH weekly_ads AS (
        SELECT
          DATE_TRUNC('week', date)::date AS week_start,
          SUM(spend)::bigint AS total_spend,
          COUNT(DISTINCT campaign_id) AS total_camps,
          COUNT(DISTINCT mkt_name) AS active_mkts
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND date >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 84
        GROUP BY 1
      ),
      weekly_orders AS (
        SELECT
          DATE_TRUNC('week', date)::date AS week_start,
          COUNT(*) AS order_count,
          COALESCE(SUM(cod_amount), 0)::bigint AS total_cod
        FROM v_camp_orders
        GROUP BY 1
      )
      SELECT
        wa.week_start,
        wa.week_start + 6 AS week_end,
        wa.total_spend,
        COALESCE(wo.total_cod, 0) AS total_cod,
        COALESCE(wo.order_count, 0) AS order_count,
        wa.total_camps,
        wa.active_mkts,
        CASE WHEN COALESCE(wo.total_cod, 0) > 0
          THEN ROUND(wa.total_spend::numeric / wo.total_cod * 100, 1)
        END AS care_pct,
        -- So tuần trước
        LAG(CASE WHEN COALESCE(wo.total_cod,0) > 0
              THEN ROUND(wa.total_spend::numeric / wo.total_cod * 100, 1) END)
          OVER (ORDER BY wa.week_start) AS care_pct_prev_week
      FROM weekly_ads wa
      LEFT JOIN weekly_orders wo ON wo.week_start = wa.week_start
      ORDER BY wa.week_start DESC;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP VIEW IF EXISTS v_shop_weekly;
      DROP VIEW IF EXISTS v_mkt_summary;
      DROP VIEW IF EXISTS v_mkt_daily;
    `)
  }
}
