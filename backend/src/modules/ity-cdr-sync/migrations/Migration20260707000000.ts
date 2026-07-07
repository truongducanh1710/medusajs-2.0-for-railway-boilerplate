import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260707000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS ity_cdr_call (
        id TEXT PRIMARY KEY,
        calldate TIMESTAMPTZ NOT NULL,
        direction TEXT NOT NULL DEFAULT '',
        extension TEXT NOT NULL DEFAULT '',
        agent_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        duration INT NOT NULL DEFAULT 0,
        billsec INT NOT NULL DEFAULT 0,
        disposition TEXT NOT NULL DEFAULT '',
        recording_url TEXT,
        raw JSONB NOT NULL DEFAULT '{}',
        synced_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_ity_cdr_call_calldate ON ity_cdr_call (calldate DESC);
      CREATE INDEX IF NOT EXISTS idx_ity_cdr_call_extension ON ity_cdr_call (extension, calldate DESC);
      CREATE INDEX IF NOT EXISTS idx_ity_cdr_call_customer_phone ON ity_cdr_call (customer_phone);

      CREATE TABLE IF NOT EXISTS ity_cdr_sync_job (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'queued',
        from_date TIMESTAMPTZ NOT NULL,
        to_date TIMESTAMPTZ NOT NULL,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        stats JSONB NOT NULL DEFAULT '{}',
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_ity_cdr_sync_job_status ON ity_cdr_sync_job (status, started_at DESC);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TABLE IF EXISTS ity_cdr_sync_job;
      DROP TABLE IF EXISTS ity_cdr_call;
    `)
  }
}
