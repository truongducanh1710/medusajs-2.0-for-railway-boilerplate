import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Thêm cột `market` để phân biệt shop Pancake (VN vs Malaysia TikTok Shop).
 * Default 'VN' cho toàn bộ dữ liệu cũ — backward-compat, không cần backfill riêng.
 */
export class Migration20260703000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE pancake_order ADD COLUMN IF NOT EXISTS market VARCHAR(8) NOT NULL DEFAULT 'VN'`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_pancake_order_market ON pancake_order (market, pancake_created_at)`)

    this.addSql(`ALTER TABLE pancake_sync_job ADD COLUMN IF NOT EXISTS market VARCHAR(8) NOT NULL DEFAULT 'VN'`)

    this.addSql(`ALTER TABLE pancake_cron_log ADD COLUMN IF NOT EXISTS market VARCHAR(8) DEFAULT 'VN'`)
    this.addSql(`ALTER TABLE pancake_webhook_log ADD COLUMN IF NOT EXISTS market VARCHAR(8) DEFAULT 'VN'`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE pancake_webhook_log DROP COLUMN IF EXISTS market`)
    this.addSql(`ALTER TABLE pancake_cron_log DROP COLUMN IF EXISTS market`)
    this.addSql(`ALTER TABLE pancake_sync_job DROP COLUMN IF EXISTS market`)
    this.addSql(`DROP INDEX IF EXISTS idx_pancake_order_market`)
    this.addSql(`ALTER TABLE pancake_order DROP COLUMN IF EXISTS market`)
  }
}
