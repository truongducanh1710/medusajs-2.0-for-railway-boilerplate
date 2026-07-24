import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Bảng job_run_log: ghi lại mỗi lần cron job chạy (job_name, ran_at, status, detail).
// Thêm sau sự cố mkt-task-recurring bỏ lỡ tick 00:00 VN 24/07/2026 mà không có cách
// nào kiểm tra lại vì Railway CLI chỉ giữ log ngắn hạn.
export class Migration20260724000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS job_run_log (
        id TEXT NOT NULL PRIMARY KEY,
        job_name TEXT NOT NULL,
        ran_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL,
        detail JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_job_run_log_job_name_ran_at ON job_run_log (job_name, ran_at)`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS job_run_log`)
  }
}
