import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260525000002 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS agent_heartbeat (
        run_id UUID PRIMARY KEY,
        model VARCHAR(64),
        mkt VARCHAR(32),
        phase VARCHAR(32),               -- 'starting' | 'tool_loop' | 'reflection' | 'evaluator' | 'done' | 'error'
        iteration INT DEFAULT 0,
        last_action TEXT,                -- 'calling get_camp_metrics(mkt=KIENLB)' etc
        recs_so_far INT DEFAULT 0,
        tokens_used INT DEFAULT 0,
        error TEXT,
        started_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_updated ON agent_heartbeat (updated_at DESC);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS agent_heartbeat;`)
  }
}
