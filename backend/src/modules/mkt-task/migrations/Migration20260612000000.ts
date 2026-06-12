import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260612000000 extends Migration {
  async up(): Promise<void> {
    // Recurring task support: output / result / frequency / template linkage
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS output      TEXT NULL`)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS result      TEXT NULL`)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS frequency   TEXT NOT NULL DEFAULT 'once'`)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false`)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS template_id TEXT NULL`)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS period_key  TEXT NULL`)

    // Indexes hỗ trợ job spawn + lọc instance theo template
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_task_template_idx ON mkt_task (template_id) WHERE deleted_at IS NULL`)
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_task_is_template_idx ON mkt_task (is_template) WHERE deleted_at IS NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS mkt_task_is_template_idx`)
    this.addSql(`DROP INDEX IF EXISTS mkt_task_template_idx`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS period_key`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS template_id`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS is_template`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS frequency`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS result`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS output`)
  }
}
