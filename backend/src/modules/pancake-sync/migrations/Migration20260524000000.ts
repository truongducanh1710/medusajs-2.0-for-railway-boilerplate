import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260524000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE mkt_ads_cost
      ADD COLUMN IF NOT EXISTS effective_status VARCHAR(32),
      ADD COLUMN IF NOT EXISTS daily_budget BIGINT
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE mkt_ads_cost
      DROP COLUMN IF EXISTS effective_status,
      DROP COLUMN IF EXISTS daily_budget
    `)
  }
}
