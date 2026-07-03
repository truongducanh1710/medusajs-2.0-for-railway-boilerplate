import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260703020000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE fb_bot_agent ADD COLUMN IF NOT EXISTS active_prompt_version_id UUID;`)
    this.addSql(`ALTER TABLE fb_bot_agent ADD COLUMN IF NOT EXISTS prompt_score NUMERIC;`)
    this.addSql(`ALTER TABLE fb_bot_agent ADD COLUMN IF NOT EXISTS last_eval_at TIMESTAMPTZ;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS fb_bot_prompt_version (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL REFERENCES fb_bot_agent(id) ON DELETE CASCADE,
        page_id VARCHAR(32),
        version INT NOT NULL,
        prompt_text TEXT NOT NULL,
        change_reason TEXT,
        score_before NUMERIC,
        score_after NUMERIC,
        eval_summary TEXT,
        scenarios JSONB DEFAULT '[]',
        status VARCHAR(24) DEFAULT 'draft',
        created_by VARCHAR(64) DEFAULT 'ai',
        approved_by VARCHAR(255),
        approved_at TIMESTAMPTZ,
        activated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(agent_id, version)
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_bot_prompt_agent ON fb_bot_prompt_version (agent_id, created_at DESC);`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_bot_prompt_status ON fb_bot_prompt_version (status, created_at DESC);`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS fb_bot_prompt_version CASCADE;`)
    this.addSql(`ALTER TABLE fb_bot_agent DROP COLUMN IF EXISTS active_prompt_version_id;`)
    this.addSql(`ALTER TABLE fb_bot_agent DROP COLUMN IF EXISTS prompt_score;`)
    this.addSql(`ALTER TABLE fb_bot_agent DROP COLUMN IF EXISTS last_eval_at;`)
  }
}
