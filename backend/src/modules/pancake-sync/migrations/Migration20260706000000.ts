import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260706000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      -- Cột ad_platform: nguồn traffic quảng cáo trả phí (facebook | google | organic)
      -- Tách biệt với "source" (kênh bán: webcake/facebook-mess/zalo/...)
      ALTER TABLE pancake_order
        ADD COLUMN IF NOT EXISTS ad_platform VARCHAR(16);
      CREATE INDEX IF NOT EXISTS idx_pancake_order_ad_platform
        ON pancake_order (ad_platform, pancake_created_at)
        WHERE ad_platform IS NOT NULL;

      -- Backfill: đơn có gclid/gbraid/gad_ trong raw hoặc ads_source=Google → google
      UPDATE pancake_order
      SET ad_platform = 'google'
      WHERE ad_platform IS NULL
        AND raw IS NOT NULL
        AND (
          raw::text ILIKE '%"ads_source":"Google"%'
          OR raw::text ILIKE '%gclid=%'
          OR raw::text ILIKE '%gbraid=%'
          OR raw::text ILIKE '%gad_source=%'
        );

      -- Backfill: đơn có fb_campaign_id đã extract sẵn → facebook
      UPDATE pancake_order
      SET ad_platform = 'facebook'
      WHERE ad_platform IS NULL
        AND fb_campaign_id IS NOT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE pancake_order DROP COLUMN IF EXISTS ad_platform;
    `)
  }
}
