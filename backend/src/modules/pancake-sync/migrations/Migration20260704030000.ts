import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Re-add cột `market` — migration trước (Migration20260703000000) bị đánh dấu "executed"
 * trong mikro_orm_migrations nhưng cột thực tế không được tạo trên production. Đặt tên
 * mới + IF NOT EXISTS để chắc chắn chạy lại an toàn (idempotent) bất kể trạng thái hiện tại.
 */
export class Migration20260704030000 extends Migration {
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
