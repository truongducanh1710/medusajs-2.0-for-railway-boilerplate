import { Migration } from "@mikro-orm/migrations"

export class Migration20260523000000 extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS mkt_ads_cost (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        mkt_name VARCHAR(32) NOT NULL,
        ad_account_id VARCHAR(32) NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        campaign_name TEXT NOT NULL,
        spend BIGINT NOT NULL DEFAULT 0,
        impressions INT NOT NULL DEFAULT 0,
        clicks INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        deleted_at TIMESTAMPTZ,
        UNIQUE (date, campaign_id)
      );
      CREATE INDEX IF NOT EXISTS idx_mkt_ads_cost_date_mkt ON mkt_ads_cost (date, mkt_name);
    `)
  }

  async down(): Promise<void> {
    await this.execute(`DROP TABLE IF EXISTS mkt_ads_cost`)
  }
}
