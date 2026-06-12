import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260613000000 extends Migration {
  async up(): Promise<void> {
    // Checklist tự quản của assignee: [{ id, text, done }]
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS checklist JSONB NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS checklist`)
  }
}
