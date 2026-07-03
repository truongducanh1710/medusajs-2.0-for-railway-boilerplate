import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260703000000 extends Migration {
  async up(): Promise<void> {
    // CSKH call task: product name selected when bulk-creating customer calls.
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS product_name TEXT NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS product_name`)
  }
}
