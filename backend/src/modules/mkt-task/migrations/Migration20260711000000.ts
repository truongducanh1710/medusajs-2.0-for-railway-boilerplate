import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260711000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ NULL`)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS first_called_at TIMESTAMPTZ NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS called_at`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS first_called_at`)
  }
}
