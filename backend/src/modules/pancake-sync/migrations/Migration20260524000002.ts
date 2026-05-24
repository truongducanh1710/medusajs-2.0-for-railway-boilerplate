import { Migration } from "@mikro-orm/migrations"

export class Migration20260524000002 extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS agent_camp_recommendation (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        campaign_name TEXT NOT NULL,
        mkt_name VARCHAR(32) NOT NULL,
        action VARCHAR(32) NOT NULL,
        reason TEXT NOT NULL,
        old_value JSONB,
        suggested_value JSONB,
        confidence VARCHAR(8) DEFAULT 'medium',
        status VARCHAR(16) DEFAULT 'pending',
        approved_by VARCHAR(255),
        approved_at TIMESTAMPTZ,
        executed_at TIMESTAMPTZ,
        fb_response JSONB,
        agent_model VARCHAR(64),
        prompt_tokens INT,
        completion_tokens INT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_agent_rec_run ON agent_camp_recommendation (run_id);
      CREATE INDEX IF NOT EXISTS idx_agent_rec_mkt ON agent_camp_recommendation (mkt_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_rec_status ON agent_camp_recommendation (status, created_at DESC);

      CREATE TABLE IF NOT EXISTS agent_art_rollout (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL UNIQUE,
        messages JSONB NOT NULL,
        tool_calls JSONB,
        rule_decisions JSONB,
        outcomes JSONB,
        reward NUMERIC,
        model VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_agent_rollout_run ON agent_art_rollout (run_id);
    `)
  }

  async down(): Promise<void> {
    await this.execute(`
      DROP TABLE IF EXISTS agent_camp_recommendation;
      DROP TABLE IF EXISTS agent_art_rollout;
    `)
  }
}
