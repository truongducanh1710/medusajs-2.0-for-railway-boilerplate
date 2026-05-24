import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260525000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE agent_camp_recommendation
        ADD COLUMN IF NOT EXISTS reflection_passed BOOLEAN DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS reflection_notes TEXT,
        ADD COLUMN IF NOT EXISTS evaluator_model VARCHAR(64),
        ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
        ADD COLUMN IF NOT EXISTS validation_retries INT DEFAULT 0;

      CREATE TABLE IF NOT EXISTS agent_memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id VARCHAR(64) NOT NULL,
        mkt_name VARCHAR(32) NOT NULL,
        action VARCHAR(32) NOT NULL,
        rejection_reason TEXT NOT NULL,
        rejected_count INT DEFAULT 1,
        last_rejected_at TIMESTAMPTZ DEFAULT now(),
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (campaign_id, action)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_memory_camp ON agent_memory (campaign_id);
      CREATE INDEX IF NOT EXISTS idx_agent_memory_mkt ON agent_memory (mkt_name, last_rejected_at DESC);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE agent_camp_recommendation
        DROP COLUMN IF EXISTS reflection_passed,
        DROP COLUMN IF EXISTS reflection_notes,
        DROP COLUMN IF EXISTS evaluator_model,
        DROP COLUMN IF EXISTS rejection_reason,
        DROP COLUMN IF EXISTS validation_retries;

      DROP TABLE IF EXISTS agent_memory;
    `)
  }
}
