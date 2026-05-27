import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260527100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS ai_feature_config (
        key           VARCHAR(100) PRIMARY KEY,
        enabled       BOOLEAN NOT NULL DEFAULT true,
        model         VARCHAR(200),
        provider      VARCHAR(50),
        notes         TEXT,
        updated_by    VARCHAR(200),
        updated_at    TIMESTAMPTZ DEFAULT now()
      )
    `)

    this.addSql(`
      INSERT INTO ai_feature_config (key, enabled, model, provider, notes) VALUES
        ('camp_ai_agent',     true, 'deepseek-v4-pro',                  'deepseek',    'Agent tối ưu campaign chạy mỗi 4h'),
        ('camp_ai_evaluator', true, 'google/gemini-3.5-flash',           'openrouter',  'Evaluator độc lập chấm điểm recommendation'),
        ('cskh_analysis',     true, 'qwen/qwen2.5-vl-72b-instruct',      'openrouter',  'Phân tích đơn hàng CSKH')
      ON CONFLICT (key) DO NOTHING
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS ai_feature_config`)
  }
}
