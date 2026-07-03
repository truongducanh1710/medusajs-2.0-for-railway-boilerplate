import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Migration20260610000000 tao bang ai_usage_log bang this.execute() thay vi
 * this.addSql() — khac voi moi migration khac trong repo. Ket qua: bang chua
 * tung duoc tao that tren production du migration runner da danh dau la "run",
 * nen logAiUsage() (goi tu chat-bot, video_analysis, camp_ai_agent...) fail
 * am tham moi lan (co try/catch nuot loi) — khong ai theo doi duoc chi phi AI.
 * Migration nay dung addSql() dung chuan, idempotent (IF NOT EXISTS) nen an
 * toan chay lai ngay ca khi runner da coi Migration20260610000000 la done.
 */
export class Migration20260704000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS ai_usage_log (
        id                SERIAL PRIMARY KEY,
        feature           VARCHAR(100) NOT NULL,
        run_id            VARCHAR(200),
        model             VARCHAR(200) NOT NULL,
        provider          VARCHAR(50)  NOT NULL,
        prompt_tokens     INT          NOT NULL DEFAULT 0,
        completion_tokens INT          NOT NULL DEFAULT 0,
        total_tokens      INT          NOT NULL DEFAULT 0,
        cost_usd          NUMERIC(10,6) NOT NULL DEFAULT 0,
        context           JSONB,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS ai_usage_log_feature_created_idx ON ai_usage_log (feature, created_at DESC);`)
    this.addSql(`CREATE INDEX IF NOT EXISTS ai_usage_log_run_id_idx ON ai_usage_log (run_id);`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS ai_usage_log;`)
  }
}
