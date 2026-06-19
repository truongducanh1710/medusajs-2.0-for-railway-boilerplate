import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Evaluation Framework cho AI Agent:
 *
 * 1. marketer_action_log — ghi mọi action MARKETER thật làm (không qua agent recommend)
 *    → ground truth để so sánh: agent recommend gì vs marketer thật làm gì
 *
 * 2. agent_decision_snapshot — snapshot before/after mỗi recommendation
 *    → biết outcome thật của 1 decision (camp này sau khi pause/giảm budget thì care thay đổi ra sao)
 *
 * 3. reasoning_step — parse agent_art_rollout messages thành các step có cấu trúc
 *    → biết agent đang ở bước nào của workflow, đọc data gì, kết luận gì
 *
 * 4. agent_error_tag — phân loại lỗi cho mỗi rec/run (manual hoặc auto)
 *    → biết agent fail ở tầng nào (model / kiến trúc / code)
 */
export class Migration20260526000006 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DROP VIEW IF EXISTS v_agent_vs_marketer;
      DROP VIEW IF EXISTS v_marketer_action_log;

      -- 1. MARKETER ACTION LOG — ground truth
      -- camp_action_log đã có nhưng mix cả agent + marketer + scheduled
      -- View này filter ra chỉ action MANUAL của marketer (source='manual')
      -- + thêm cột phục vụ đánh giá
      CREATE OR REPLACE VIEW v_marketer_action_log AS
      SELECT
        cal.id, cal.campaign_id, cal.campaign_name, cal.action,
        cal.old_value, cal.new_value, cal.user_email, cal.success,
        cal.created_at,
        -- Match xem có agent recommendation nào trước đó 4h không
        (SELECT r.id FROM agent_camp_recommendation r
         WHERE r.campaign_id = cal.campaign_id
           AND r.created_at < cal.created_at
           AND r.created_at > cal.created_at - interval '4 hours'
         ORDER BY r.created_at DESC LIMIT 1) AS prior_rec_id,
        (SELECT r.action FROM agent_camp_recommendation r
         WHERE r.campaign_id = cal.campaign_id
           AND r.created_at < cal.created_at
           AND r.created_at > cal.created_at - interval '4 hours'
         ORDER BY r.created_at DESC LIMIT 1) AS prior_rec_action,
        (SELECT r.status FROM agent_camp_recommendation r
         WHERE r.campaign_id = cal.campaign_id
           AND r.created_at < cal.created_at
           AND r.created_at > cal.created_at - interval '4 hours'
         ORDER BY r.created_at DESC LIMIT 1) AS prior_rec_status
      FROM camp_action_log cal
      WHERE cal.source = 'manual';

      -- 2. AGENT DECISION SNAPSHOT — before/after metrics per recommendation
      CREATE TABLE IF NOT EXISTS agent_decision_snapshot (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rec_id UUID NOT NULL,                  -- agent_camp_recommendation.id
        run_id UUID NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        snapshot_type VARCHAR(16) NOT NULL,    -- 'before' | 'after_4h' | 'after_eod'
        -- Metrics tại thời điểm snapshot
        spend BIGINT,
        impressions INTEGER,
        clicks INTEGER,
        cod_orders INTEGER,
        cod_amount BIGINT,
        care_pct NUMERIC(6,1),
        cpm BIGINT,
        ctr_pct NUMERIC(5,2),
        effective_status VARCHAR(32),
        daily_budget BIGINT,
        -- Shop-level context
        shop_care_pct NUMERIC(6,1),
        shop_cod BIGINT,
        snapshot_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (rec_id, snapshot_type)
      );
      CREATE INDEX IF NOT EXISTS idx_decision_snap_rec ON agent_decision_snapshot (rec_id, snapshot_type);
      CREATE INDEX IF NOT EXISTS idx_decision_snap_run ON agent_decision_snapshot (run_id);
      CREATE INDEX IF NOT EXISTS idx_decision_snap_camp ON agent_decision_snapshot (campaign_id, snapshot_at DESC);

      -- 3. REASONING STEP — parse rollout messages thành structured steps
      CREATE TABLE IF NOT EXISTS agent_reasoning_step (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL,
        step_idx INT NOT NULL,                 -- thứ tự trong rollout
        step_type VARCHAR(32) NOT NULL,        -- 'tool_call' | 'tool_result' | 'thinking' | 'decision'
        tool_name VARCHAR(64),                 -- nếu là tool_call
        tool_args JSONB,
        tool_result_summary TEXT,              -- tóm tắt result (count rows / first row keys)
        tool_result_size INT,                  -- số bytes của result raw
        message_text TEXT,                     -- nếu là thinking/decision text
        token_estimate INT,                    -- ước lượng token của step
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (run_id, step_idx)
      );
      CREATE INDEX IF NOT EXISTS idx_reasoning_run ON agent_reasoning_step (run_id, step_idx);
      CREATE INDEX IF NOT EXISTS idx_reasoning_tool ON agent_reasoning_step (tool_name) WHERE tool_name IS NOT NULL;

      -- 4. ERROR TAG — phân loại lỗi theo tầng
      CREATE TABLE IF NOT EXISTS agent_error_tag (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        target_type VARCHAR(16) NOT NULL,      -- 'rec' | 'run'
        target_id UUID NOT NULL,               -- rec_id or run_id
        layer VARCHAR(16) NOT NULL,            -- 'model' | 'architecture' | 'code' | 'data' | 'skill'
        category VARCHAR(64) NOT NULL,         -- 'hallucination' | 'missing_context' | 'wrong_tool' | 'bad_logic' | ...
        severity VARCHAR(16) DEFAULT 'medium', -- 'low' | 'medium' | 'high' | 'critical'
        note TEXT,
        tagged_by VARCHAR(255),                -- user_email or 'auto'
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_error_tag_target ON agent_error_tag (target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_error_tag_layer ON agent_error_tag (layer, category, created_at DESC);

      -- 5. VIEW tổng hợp — agreement giữa agent recommend vs marketer thật làm
      CREATE OR REPLACE VIEW v_agent_vs_marketer AS
      WITH rec_marketer_match AS (
        SELECT
          r.id AS rec_id, r.run_id, r.campaign_id, r.campaign_name, r.mkt_name,
          r.action AS agent_action, r.confidence, r.status AS rec_status, r.agent_model,
          r.created_at AS rec_at,
          -- Marketer action gần nhất TRONG 6h sau khi agent rec
          (SELECT cal.action FROM camp_action_log cal
           WHERE cal.campaign_id = r.campaign_id
             AND cal.source = 'manual'
             AND cal.created_at > r.created_at
             AND cal.created_at < r.created_at + interval '6 hours'
           ORDER BY cal.created_at ASC LIMIT 1) AS marketer_action,
          (SELECT cal.created_at FROM camp_action_log cal
           WHERE cal.campaign_id = r.campaign_id
             AND cal.source = 'manual'
             AND cal.created_at > r.created_at
             AND cal.created_at < r.created_at + interval '6 hours'
           ORDER BY cal.created_at ASC LIMIT 1) AS marketer_action_at
        FROM agent_camp_recommendation r
      )
      SELECT
        rec_id, run_id, campaign_id, campaign_name, mkt_name,
        agent_action, marketer_action,
        CASE
          WHEN marketer_action IS NULL THEN 'no_marketer_action'
          WHEN marketer_action = agent_action THEN 'agree'
          WHEN agent_action = 'no_action' AND marketer_action IS NOT NULL THEN 'agent_missed'
          WHEN marketer_action IS NULL AND agent_action != 'no_action' THEN 'agent_extra'
          ELSE 'disagree'
        END AS agreement,
        confidence, rec_status, agent_model, rec_at, marketer_action_at
      FROM rec_marketer_match;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP VIEW IF EXISTS v_agent_vs_marketer;
      DROP TABLE IF EXISTS agent_error_tag;
      DROP TABLE IF EXISTS agent_reasoning_step;
      DROP TABLE IF EXISTS agent_decision_snapshot;
      DROP VIEW IF EXISTS v_marketer_action_log;
    `)
  }
}
