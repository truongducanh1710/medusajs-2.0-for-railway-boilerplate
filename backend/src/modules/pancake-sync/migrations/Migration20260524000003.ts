import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260524000003 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS fb_camp_activity (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ad_account_id VARCHAR(32) NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        campaign_name TEXT NOT NULL,
        mkt_name VARCHAR(32) NOT NULL,
        actor_name VARCHAR(255) NOT NULL,
        actor_type VARCHAR(16) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        event_time TIMESTAMPTZ NOT NULL,
        old_value JSONB,
        new_value JSONB,
        extra_data JSONB,
        fb_object_id VARCHAR(64),
        synced_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (ad_account_id, fb_object_id, event_time, event_type)
      );
      CREATE INDEX IF NOT EXISTS idx_fb_camp_activity_camp ON fb_camp_activity (campaign_id, event_time DESC);
      CREATE INDEX IF NOT EXISTS idx_fb_camp_activity_mkt ON fb_camp_activity (mkt_name, event_time DESC);
      CREATE INDEX IF NOT EXISTS idx_fb_camp_activity_date ON fb_camp_activity (event_time DESC);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS fb_camp_activity;`)
  }
}
