import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260526000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      -- Bảng skill/insight agent học được từ data
      CREATE TABLE IF NOT EXISTS agent_insight (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope JSONB,
        category VARCHAR(32),
        insight TEXT NOT NULL,
        evidence JSONB,
        applied_count INT DEFAULT 0,
        outcome_score NUMERIC,
        agent_model VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT now(),
        last_used_at TIMESTAMPTZ,
        active BOOLEAN DEFAULT true
      );
      CREATE INDEX IF NOT EXISTS idx_insight_scope ON agent_insight USING GIN (scope);
      CREATE INDEX IF NOT EXISTS idx_insight_category ON agent_insight (category, created_at DESC);

      -- View: camp hôm nay (data ICT-aware)
      CREATE OR REPLACE VIEW v_camp_today AS
        SELECT
          c.campaign_id, c.campaign_name, c.mkt_name, c.effective_status,
          c.daily_budget, c.spend, c.impressions, c.clicks, c.date,
          CASE WHEN c.impressions > 0 THEN ROUND(c.spend::numeric / c.impressions * 1000) END AS cpm,
          CASE WHEN c.clicks > 0 THEN ROUND(c.spend::numeric / c.clicks) END AS cpc,
          CASE WHEN c.impressions > 0 THEN ROUND(c.clicks::numeric / c.impressions * 100, 2) END AS ctr
        FROM mkt_ads_cost c
        WHERE c.date = (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL)
          AND c.deleted_at IS NULL;

      -- View: lịch sử 90 ngày all camps
      CREATE OR REPLACE VIEW v_camp_history AS
        SELECT
          campaign_id, campaign_name, mkt_name, effective_status,
          date, daily_budget, spend, impressions, clicks,
          CASE WHEN impressions > 0 THEN ROUND(spend::numeric / impressions * 1000) END AS cpm,
          CASE WHEN clicks > 0 THEN ROUND(spend::numeric / clicks) END AS cpc
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND date >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 90;

      -- View: đơn webcake/manual đã filter sạch (nháp/trùng)
      CREATE OR REPLACE VIEW v_camp_orders AS
        SELECT
          po.id, po.pancake_created_at::date AS date,
          po.cod_amount, po.status,
          po.raw->>'p_utm_source' AS utm_source,
          po.raw->>'p_utm_campaign' AS utm_campaign,
          po.raw->>'p_utm_medium' AS utm_medium
        FROM pancake_order po
        WHERE po.deleted_at IS NULL
          AND po.source IN ('manual','webcake')
          AND NOT (po.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
          AND NOT (po.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
          AND po.pancake_created_at >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 90;

      -- View: care_pct shop theo ngày (45 ngày)
      CREATE OR REPLACE VIEW v_shop_care_daily AS
        SELECT
          mac.date,
          SUM(mac.spend)::bigint AS total_spend,
          COALESCE(SUM(po.cod_amount), 0)::bigint AS total_cod,
          ROUND(SUM(mac.spend)::numeric / NULLIF(SUM(po.cod_amount), 0) * 100, 1) AS care_pct,
          COUNT(DISTINCT mac.campaign_id) AS active_camps,
          COUNT(DISTINCT po.id) AS order_count
        FROM mkt_ads_cost mac
        LEFT JOIN pancake_order po
          ON po.pancake_created_at::date = mac.date
          AND po.source IN ('manual','webcake')
          AND po.deleted_at IS NULL
          AND NOT (po.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
          AND NOT (po.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
        WHERE mac.deleted_at IS NULL
          AND mac.date >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 45
        GROUP BY mac.date
        ORDER BY mac.date DESC;

      -- View: care_pct per camp theo window 3/7/14d
      CREATE OR REPLACE VIEW v_camp_care_window AS
        WITH max_d AS (SELECT MAX(date) AS d FROM mkt_ads_cost WHERE deleted_at IS NULL)
        SELECT
          mac.campaign_id,
          MAX(mac.campaign_name) AS campaign_name,
          MAX(mac.mkt_name) AS mkt_name,
          MAX(mac.effective_status) AS effective_status,
          (SELECT d FROM max_d) AS as_of,
          -- 3 ngày
          SUM(mac.spend) FILTER (WHERE mac.date >= (SELECT d FROM max_d) - 2)::bigint AS spend_3d,
          COUNT(DISTINCT po.id) FILTER (WHERE po.date >= (SELECT d FROM max_d) - 2) AS cod_3d,
          ROUND(SUM(mac.spend) FILTER (WHERE mac.date >= (SELECT d FROM max_d) - 2)::numeric
            / NULLIF(SUM(po.cod_amount) FILTER (WHERE po.date >= (SELECT d FROM max_d) - 2), 0) * 100, 1) AS care_3d,
          -- 7 ngày
          SUM(mac.spend) FILTER (WHERE mac.date >= (SELECT d FROM max_d) - 6)::bigint AS spend_7d,
          COUNT(DISTINCT po.id) FILTER (WHERE po.date >= (SELECT d FROM max_d) - 6) AS cod_7d,
          ROUND(SUM(mac.spend) FILTER (WHERE mac.date >= (SELECT d FROM max_d) - 6)::numeric
            / NULLIF(SUM(po.cod_amount) FILTER (WHERE po.date >= (SELECT d FROM max_d) - 6), 0) * 100, 1) AS care_7d,
          -- 14 ngày
          SUM(mac.spend) FILTER (WHERE mac.date >= (SELECT d FROM max_d) - 13)::bigint AS spend_14d,
          COUNT(DISTINCT po.id) FILTER (WHERE po.date >= (SELECT d FROM max_d) - 13) AS cod_14d,
          ROUND(SUM(mac.spend) FILTER (WHERE mac.date >= (SELECT d FROM max_d) - 13)::numeric
            / NULLIF(SUM(po.cod_amount) FILTER (WHERE po.date >= (SELECT d FROM max_d) - 13), 0) * 100, 1) AS care_14d
        FROM mkt_ads_cost mac
        LEFT JOIN v_camp_orders po
          ON (po.utm_source = mac.campaign_name OR po.utm_campaign = mac.campaign_name)
          AND po.date = mac.date
        WHERE mac.deleted_at IS NULL
          AND mac.date >= (SELECT d FROM max_d) - 13
        GROUP BY mac.campaign_id;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP VIEW IF EXISTS v_camp_care_window;
      DROP VIEW IF EXISTS v_shop_care_daily;
      DROP VIEW IF EXISTS v_camp_orders;
      DROP VIEW IF EXISTS v_camp_history;
      DROP VIEW IF EXISTS v_camp_today;
      DROP TABLE IF EXISTS agent_insight;
    `)
  }
}
