import { Migration } from "@mikro-orm/migrations"

export class Migration20260523000001 extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS fb_ad_account (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id VARCHAR(32) NOT NULL UNIQUE,
        account_name TEXT NOT NULL DEFAULT '',
        mkt_name VARCHAR(32) NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT true,
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_fb_ad_account_active ON fb_ad_account (active) WHERE deleted_at IS NULL;
    `)
  }

  async down(): Promise<void> {
    await this.execute(`DROP TABLE IF EXISTS fb_ad_account`)
  }
}
