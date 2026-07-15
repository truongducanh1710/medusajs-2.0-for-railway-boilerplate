import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260715000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS mkt_presence_session (
        id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'online',
        started_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        last_active_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ NULL,
        active_seconds INTEGER NOT NULL DEFAULT 0,
        idle_seconds INTEGER NOT NULL DEFAULT 0,
        day_key TEXT NOT NULL,
        user_agent TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT mkt_presence_session_pkey PRIMARY KEY (id)
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_presence_session_day_idx ON mkt_presence_session (day_key, user_email)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_presence_session_live_idx ON mkt_presence_session (user_email, ended_at)`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS mkt_presence_session`)
  }
}
