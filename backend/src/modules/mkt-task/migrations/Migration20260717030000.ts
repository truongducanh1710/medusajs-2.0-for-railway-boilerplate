import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260717030000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS device TEXT NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS device`)
  }
}
