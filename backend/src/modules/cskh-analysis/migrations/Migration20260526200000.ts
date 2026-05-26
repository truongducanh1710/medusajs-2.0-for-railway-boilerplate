import { Migration } from "@mikro-orm/migrations"

export class Migration20260526200000 extends Migration {
  async up(): Promise<void> {
    // 1. Thêm cột learning loop vào agent_insight (nếu chưa có)
    await this.execute(`
      ALTER TABLE agent_insight
        ADD COLUMN IF NOT EXISTS skill_type        VARCHAR(20) DEFAULT 'insight',
        ADD COLUMN IF NOT EXISTS condition_when    TEXT,
        ADD COLUMN IF NOT EXISTS action_then       TEXT,
        ADD COLUMN IF NOT EXISTS confidence_pct    SMALLINT DEFAULT 55,
        ADD COLUMN IF NOT EXISTS times_correct     INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS times_wrong       INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS source            VARCHAR(50),
        ADD COLUMN IF NOT EXISTS invalidated_at    TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS invalidation_reason TEXT
    `)

    // Backfill: seed rows (source='seed') dùng skill_type='skill'
    await this.execute(`
      UPDATE agent_insight SET skill_type = 'skill', confidence_pct = 60
      WHERE source = 'seed' AND skill_type = 'insight'
    `)

    // 2. agent_prediction — dự đoán cuối ngày
    await this.execute(`
      CREATE TABLE IF NOT EXISTS agent_prediction (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id                UUID NOT NULL,
        date                  DATE NOT NULL,
        prediction_hour       SMALLINT NOT NULL,
        scope                 VARCHAR(10) NOT NULL CHECK (scope IN ('shop','mkt','camp')),
        scope_id              VARCHAR(200),
        predicted_eod_spend   BIGINT NOT NULL DEFAULT 0,
        predicted_eod_cod     BIGINT NOT NULL DEFAULT 0,
        predicted_eod_care    NUMERIC(6,2) NOT NULL DEFAULT 0,
        actual_eod_spend      BIGINT,
        actual_eod_cod        BIGINT,
        actual_eod_care       NUMERIC(6,2),
        prediction_basis      TEXT,
        skills_used           JSONB DEFAULT '[]',
        evaluated_at          TIMESTAMPTZ,
        created_at            TIMESTAMPTZ DEFAULT now()
      )
    `)
    await this.execute(`CREATE INDEX IF NOT EXISTS idx_agent_pred_date ON agent_prediction(date)`)
    await this.execute(`CREATE INDEX IF NOT EXISTS idx_agent_pred_run ON agent_prediction(run_id)`)

    // 3. agent_decision_snapshot — chụp metrics before/after action
    await this.execute(`
      CREATE TABLE IF NOT EXISTS agent_decision_snapshot (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rec_id            UUID NOT NULL REFERENCES agent_camp_recommendation(id) ON DELETE CASCADE,
        run_id            UUID NOT NULL,
        campaign_id       VARCHAR(100) NOT NULL,
        snapshot_type     VARCHAR(10) NOT NULL CHECK (snapshot_type IN ('before','after')),
        snapshot_at       TIMESTAMPTZ DEFAULT now(),
        spend             NUMERIC(15,2),
        impressions       BIGINT,
        clicks            INTEGER,
        cod_orders        INTEGER,
        cod_amount        BIGINT,
        care_pct          NUMERIC(6,2),
        cpm               NUMERIC(10,2),
        ctr_pct           NUMERIC(6,2),
        effective_status  VARCHAR(20),
        daily_budget      BIGINT,
        shop_care_pct     NUMERIC(6,2),
        shop_cod          BIGINT,
        UNIQUE (rec_id, snapshot_type)
      )
    `)
    await this.execute(`CREATE INDEX IF NOT EXISTS idx_snap_rec ON agent_decision_snapshot(rec_id)`)

    // 4. agent_reasoning_step — trace từng bước agent nghĩ
    await this.execute(`
      CREATE TABLE IF NOT EXISTS agent_reasoning_step (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id            UUID NOT NULL,
        step_idx          INTEGER NOT NULL,
        step_type         VARCHAR(20) NOT NULL CHECK (step_type IN ('thinking','tool_call','tool_result')),
        message_text      TEXT,
        tool_name         VARCHAR(100),
        tool_args         JSONB,
        tool_result_summary TEXT,
        tool_result_size  INTEGER,
        token_estimate    INTEGER,
        created_at        TIMESTAMPTZ DEFAULT now(),
        UNIQUE (run_id, step_idx)
      )
    `)
    await this.execute(`CREATE INDEX IF NOT EXISTS idx_reasoning_run ON agent_reasoning_step(run_id)`)

    // 5. agent_error_tag — manager tag lỗi agent
    await this.execute(`
      CREATE TABLE IF NOT EXISTS agent_error_tag (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('rec','run')),
        target_id   UUID NOT NULL,
        layer       VARCHAR(50) NOT NULL,
        category    VARCHAR(100) NOT NULL,
        severity    VARCHAR(10) DEFAULT 'medium',
        note        TEXT,
        tagged_by   VARCHAR(200),
        created_at  TIMESTAMPTZ DEFAULT now()
      )
    `)
    await this.execute(`CREATE INDEX IF NOT EXISTS idx_errtag_target ON agent_error_tag(target_type, target_id)`)

    // 6. v_agent_vs_marketer — so sánh agent action vs marketer action thực tế
    await this.execute(`
      CREATE OR REPLACE VIEW v_agent_vs_marketer AS
      SELECT
        r.id         AS rec_id,
        r.run_id,
        r.campaign_id,
        r.campaign_name,
        r.mkt_name,
        r.action     AS agent_action,
        r.confidence,
        r.agent_model,
        r.created_at AS rec_at,
        r.status,
        cal.action   AS marketer_action,
        cal.created_at AS marketer_action_at,
        CASE
          WHEN cal.action IS NULL THEN 'no_marketer_action'
          WHEN r.action = cal.action THEN 'agree'
          WHEN r.action = 'no_action' AND cal.action IS NOT NULL THEN 'agent_missed'
          WHEN r.action != 'no_action' AND cal.action IS NULL THEN 'agent_false_positive'
          ELSE 'disagree'
        END AS agreement
      FROM agent_camp_recommendation r
      LEFT JOIN LATERAL (
        SELECT action FROM camp_action_log
        WHERE campaign_id = r.campaign_id
          AND source = 'manual'
          AND created_at BETWEEN r.created_at AND r.created_at + interval '4 hours'
        ORDER BY created_at
        LIMIT 1
      ) cal ON true
    `)
  }

  async down(): Promise<void> {
    await this.execute(`DROP VIEW IF EXISTS v_agent_vs_marketer`)
    await this.execute(`DROP TABLE IF EXISTS agent_error_tag`)
    await this.execute(`DROP TABLE IF EXISTS agent_reasoning_step`)
    await this.execute(`DROP TABLE IF EXISTS agent_decision_snapshot`)
    await this.execute(`DROP TABLE IF EXISTS agent_prediction`)
    await this.execute(`
      ALTER TABLE agent_insight
        DROP COLUMN IF EXISTS skill_type,
        DROP COLUMN IF EXISTS condition_when,
        DROP COLUMN IF EXISTS action_then,
        DROP COLUMN IF EXISTS confidence_pct,
        DROP COLUMN IF EXISTS times_correct,
        DROP COLUMN IF EXISTS times_wrong,
        DROP COLUMN IF EXISTS source,
        DROP COLUMN IF EXISTS invalidated_at,
        DROP COLUMN IF EXISTS invalidation_reason
    `)
  }
}
