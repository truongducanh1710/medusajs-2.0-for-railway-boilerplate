import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260717020000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS cham_cong_log (
        id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        action TEXT NOT NULL,
        lat DOUBLE PRECISION NULL,
        lng DOUBLE PRECISION NULL,
        accuracy_m DOUBLE PRECISION NULL,
        address TEXT NULL,
        day_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT cham_cong_log_pkey PRIMARY KEY (id)
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS cham_cong_log_day_idx ON cham_cong_log (day_key, user_email)`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS cham_cong_log`)
  }
}
