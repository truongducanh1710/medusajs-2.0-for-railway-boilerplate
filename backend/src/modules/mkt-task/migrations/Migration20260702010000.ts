import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260702010000 extends Migration {
  async up(): Promise<void> {
    // CSKH gọi tư vấn (type=cskh_call): liên kết khách hàng nguồn từ đơn Pancake
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS pancake_order_id TEXT NULL`)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS customer_name TEXT NULL`)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS customer_phone TEXT NULL`)
    // CSKH: giai đoạn cuộc gọi, độc lập với status gốc. Xem CALL_STAGES ở UI.
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS call_stage TEXT NULL`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_mkt_task_pancake_order ON mkt_task (pancake_order_id) WHERE pancake_order_id IS NOT NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS idx_mkt_task_pancake_order`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS call_stage`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS customer_phone`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS customer_name`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS pancake_order_id`)
  }
}
