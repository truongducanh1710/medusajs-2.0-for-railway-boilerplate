import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260709000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS planned_for TIMESTAMPTZ NULL`)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS personal_order INTEGER NULL`)
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_task_assignee_planned_for_idx ON mkt_task (assignee_id, planned_for) WHERE deleted_at IS NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS mkt_task_assignee_planned_for_idx`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS personal_order`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS planned_for`)
  }
}