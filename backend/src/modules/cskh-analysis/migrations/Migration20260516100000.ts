import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260516100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "cskh_analysis" (
        "order_id"       VARCHAR PRIMARY KEY,
        "current_step"   TEXT,
        "next_action"    TEXT,
        "call_time"      TIMESTAMPTZ,
        "urgency"        VARCHAR(20) NOT NULL DEFAULT 'medium',
        "priority_score" INT NOT NULL DEFAULT 0,
        "analyzed_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "cskh_analysis_urgency_idx" ON "cskh_analysis" ("urgency");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "cskh_analysis_call_time_idx" ON "cskh_analysis" ("call_time");`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "cskh_analysis";`)
  }
}
