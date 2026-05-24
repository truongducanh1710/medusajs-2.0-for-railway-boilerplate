import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260524000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS camp_schedule (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id VARCHAR(64) NOT NULL,
        campaign_name TEXT NOT NULL,
        action VARCHAR(16) NOT NULL,
        payload JSONB,
        scheduled_at TIMESTAMPTZ NOT NULL,
        executed_at TIMESTAMPTZ,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        error_message TEXT,
        created_by_email VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_camp_schedule_due ON camp_schedule (status, scheduled_at)
        WHERE status = 'pending' AND deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS camp_action_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id VARCHAR(64) NOT NULL,
        campaign_name TEXT NOT NULL,
        action VARCHAR(16) NOT NULL,
        old_value JSONB,
        new_value JSONB,
        source VARCHAR(16) NOT NULL,
        schedule_id UUID,
        user_email VARCHAR(255) NOT NULL,
        fb_response JSONB,
        success BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_camp_action_log_camp ON camp_action_log (campaign_id, created_at DESC);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TABLE IF EXISTS camp_action_log;
      DROP TABLE IF EXISTS camp_schedule;
    `)
  }
}
