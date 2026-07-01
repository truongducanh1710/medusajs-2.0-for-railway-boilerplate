import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260701000000 extends Migration {
  async up(): Promise<void> {
    // Mua hàng (type=purchasing): liên kết task tới lô nhập trong bảng giá vốn (import_lot.id)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS import_lot_id TEXT NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS import_lot_id`)
  }
}
