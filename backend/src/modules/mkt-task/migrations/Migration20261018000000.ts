import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261018000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE overtime_request ALTER COLUMN source SET DEFAULT 'employee'`)
    // Archive unreviewed automatic suggestions; preserve all reviewed payroll history.
    this.addSql(`UPDATE overtime_request SET deleted_at = now(), updated_at = now()
      WHERE source = 'auto' AND status = 'pending' AND deleted_at IS NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE overtime_request ALTER COLUMN source SET DEFAULT 'auto'`)
    // Archived suggestions stay archived: restoring them can conflict with new registrations.
  }
}
