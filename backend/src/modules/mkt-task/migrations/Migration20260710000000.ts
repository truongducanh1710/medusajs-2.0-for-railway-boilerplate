import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260710000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_channel ADD COLUMN IF NOT EXISTS is_announcement BOOLEAN NOT NULL DEFAULT false`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_channel DROP COLUMN IF EXISTS is_announcement`)
  }
}
