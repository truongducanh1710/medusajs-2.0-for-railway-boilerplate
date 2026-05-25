import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260526000005 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      -- A. Hourly snapshots — không overwrite, lưu mỗi giờ 1 row per camp
      CREATE TABLE IF NOT EXISTS camp_hourly_snapshot (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        hour SMALLINT NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        campaign_name TEXT,
        mkt_name VARCHAR(32),
        spend BIGINT DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        effective_status VARCHAR(32),
        daily_budget BIGINT,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (date, hour, campaign_id)
      );
      CREATE INDEX IF NOT EXISTS idx_hs_date_camp ON camp_hourly_snapshot (date, campaign_id, hour);
      CREATE INDEX IF NOT EXISTS idx_hs_mkt ON camp_hourly_snapshot (mkt_name, date, hour);

      -- B. Predictions — agent dự đoán cuối ngày
      CREATE TABLE IF NOT EXISTS agent_prediction (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL,
        date DATE NOT NULL,
        prediction_hour SMALLINT NOT NULL,
        scope VARCHAR(32) NOT NULL,
        scope_id VARCHAR(64),
        predicted_eod_spend BIGINT,
        predicted_eod_cod BIGINT,
        predicted_eod_care NUMERIC(5,1),
        prediction_basis TEXT,
        skills_used JSONB DEFAULT '[]'::jsonb,
        actual_eod_spend BIGINT,
        actual_eod_cod BIGINT,
        actual_eod_care NUMERIC(5,1),
        care_error_pct NUMERIC(5,1),
        prediction_correct BOOLEAN,
        evaluated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_pred_date ON agent_prediction (date, scope);
      CREATE INDEX IF NOT EXISTS idx_pred_run ON agent_prediction (run_id);

      -- C. Mở rộng agent_insight cho skill lifecycle
      ALTER TABLE agent_insight
        ADD COLUMN IF NOT EXISTS skill_type VARCHAR(32) DEFAULT 'insight',
        ADD COLUMN IF NOT EXISTS condition_when TEXT,
        ADD COLUMN IF NOT EXISTS action_then TEXT,
        ADD COLUMN IF NOT EXISTS confidence_pct INT DEFAULT 60,
        ADD COLUMN IF NOT EXISTS times_correct INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS times_wrong INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS invalidation_reason TEXT,
        ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT 'agent';

      CREATE INDEX IF NOT EXISTS idx_insight_skill_active
        ON agent_insight (skill_type, active, confidence_pct DESC);

      -- D. View intraday — tốc độ chi tiêu theo giờ
      CREATE OR REPLACE VIEW v_camp_intraday AS
      WITH latest AS (
        SELECT campaign_id, MAX(hour) AS h
        FROM camp_hourly_snapshot WHERE date = CURRENT_DATE
        GROUP BY campaign_id
      )
      SELECT
        s.campaign_id, s.campaign_name, s.mkt_name,
        s.hour AS current_hour,
        s.spend AS spend_so_far,
        s.impressions, s.clicks,
        s.effective_status, s.daily_budget,
        CASE WHEN s.hour > 0
          THEN ROUND(s.spend::numeric / s.hour * 24)::bigint
        END AS projected_eod_spend,
        CASE WHEN s.daily_budget > 0
          THEN ROUND(s.spend::numeric / s.daily_budget * 100)
        END AS spend_budget_pct,
        CASE WHEN s.impressions > 0
          THEN ROUND(s.spend::numeric / s.impressions * 1000)
        END AS cpm_intraday,
        CASE WHEN s.impressions > 0
          THEN ROUND(s.clicks::numeric / s.impressions * 100, 2)
        END AS ctr_intraday
      FROM camp_hourly_snapshot s
      JOIN latest l ON l.campaign_id = s.campaign_id AND l.h = s.hour
      WHERE s.date = CURRENT_DATE;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP VIEW IF EXISTS v_camp_intraday;
      ALTER TABLE agent_insight
        DROP COLUMN IF EXISTS skill_type,
        DROP COLUMN IF EXISTS condition_when,
        DROP COLUMN IF EXISTS action_then,
        DROP COLUMN IF EXISTS confidence_pct,
        DROP COLUMN IF EXISTS times_correct,
        DROP COLUMN IF EXISTS times_wrong,
        DROP COLUMN IF EXISTS invalidated_at,
        DROP COLUMN IF EXISTS invalidation_reason,
        DROP COLUMN IF EXISTS source;
      DROP TABLE IF EXISTS agent_prediction;
      DROP TABLE IF EXISTS camp_hourly_snapshot;
    `)
  }
}
