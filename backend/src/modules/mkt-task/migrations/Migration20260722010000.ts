import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260722010000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE cham_cong_config ADD COLUMN IF NOT EXISTS ot_min_threshold_min INT NOT NULL DEFAULT 15`)
    this.addSql(`ALTER TABLE cham_cong_config ADD COLUMN IF NOT EXISTS phep_nam_per_month INT NOT NULL DEFAULT 1`)
    this.addSql(`ALTER TABLE cham_cong_config ADD COLUMN IF NOT EXISTS phep_nam_max_per_year INT NOT NULL DEFAULT 12`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS overtime_request (
        id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        day_key TEXT NOT NULL,
        duration_min INT NOT NULL,
        approved_duration_min INT NULL,
        source TEXT NOT NULL DEFAULT 'auto',
        note TEXT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewer_email TEXT NULL,
        reviewed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT overtime_request_pkey PRIMARY KEY (id)
      )
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS overtime_request_user_day_idx ON overtime_request (user_email, day_key) WHERE deleted_at IS NULL`)
    this.addSql(`CREATE INDEX IF NOT EXISTS overtime_request_status_idx ON overtime_request (status) WHERE deleted_at IS NULL`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS leave_balance (
        id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        year INT NOT NULL,
        accrued_days NUMERIC NOT NULL DEFAULT 0,
        used_days NUMERIC NOT NULL DEFAULT 0,
        last_accrual_month TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT leave_balance_pkey PRIMARY KEY (id)
      )
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS leave_balance_user_year_idx ON leave_balance (user_email, year) WHERE deleted_at IS NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS leave_balance`)
    this.addSql(`DROP TABLE IF EXISTS overtime_request`)
    this.addSql(`ALTER TABLE cham_cong_config DROP COLUMN IF EXISTS phep_nam_max_per_year`)
    this.addSql(`ALTER TABLE cham_cong_config DROP COLUMN IF EXISTS phep_nam_per_month`)
    this.addSql(`ALTER TABLE cham_cong_config DROP COLUMN IF EXISTS ot_min_threshold_min`)
  }
}
