import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260720000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`CREATE TABLE IF NOT EXISTS qa_daily_note (
      id TEXT NOT NULL,
      employee_email TEXT NOT NULL,
      dept TEXT NOT NULL,
      note_date TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'info',
      content TEXT NOT NULL,
      is_fatal BOOLEAN NOT NULL DEFAULT false,
      fatal_kind TEXT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ NULL,
      CONSTRAINT qa_daily_note_pkey PRIMARY KEY (id)
    )`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_qa_daily_note_emp_date ON qa_daily_note (employee_email, note_date) WHERE deleted_at IS NULL`)

    this.addSql(`CREATE TABLE IF NOT EXISTS qa_weekly_score (
      id TEXT NOT NULL,
      employee_email TEXT NOT NULL,
      dept TEXT NOT NULL,
      week_key TEXT NOT NULL,
      month_key TEXT NOT NULL,
      c1 INTEGER NOT NULL DEFAULT 0,
      c2 INTEGER NOT NULL DEFAULT 0,
      c3 INTEGER NOT NULL DEFAULT 0,
      c4 INTEGER NOT NULL DEFAULT 0,
      c5 INTEGER NOT NULL DEFAULT 0,
      c6 INTEGER NOT NULL DEFAULT 0,
      fatal_flag BOOLEAN NOT NULL DEFAULT false,
      total INTEGER NOT NULL DEFAULT 0,
      comment TEXT NULL,
      scored_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ NULL,
      CONSTRAINT qa_weekly_score_pkey PRIMARY KEY (id)
    )`)
    // 1 người / 1 tuần / 1 dòng — chống chấm trùng.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_weekly_emp_week ON qa_weekly_score (employee_email, week_key) WHERE deleted_at IS NULL`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_qa_weekly_month ON qa_weekly_score (month_key) WHERE deleted_at IS NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS qa_daily_note`)
    this.addSql(`DROP TABLE IF EXISTS qa_weekly_score`)
  }
}
