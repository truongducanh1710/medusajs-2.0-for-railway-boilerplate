import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260702000000 extends Migration {
  async up(): Promise<void> {
    // Mua hàng (type=purchasing): giai đoạn quy trình riêng (13 bước), độc lập status gốc
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS purchase_stage TEXT NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS purchase_stage`)
  }
}
