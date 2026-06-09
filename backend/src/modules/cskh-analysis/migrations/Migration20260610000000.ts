import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260610000000 extends Migration {
  async up(): Promise<void> {
    await this.execute(`
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
      CREATE INDEX IF NOT EXISTS ai_usage_log_feature_created_idx ON ai_usage_log (feature, created_at DESC);
      CREATE INDEX IF NOT EXISTS ai_usage_log_run_id_idx ON ai_usage_log (run_id);
    `)
  }

  async down(): Promise<void> {
    await this.execute(`DROP TABLE IF EXISTS ai_usage_log;`)
  }
}
