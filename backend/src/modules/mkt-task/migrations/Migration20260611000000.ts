import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260611000000 extends Migration {
  async up(): Promise<void> {
    // Task: priority + tags
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium'`)
    this.addSql(`ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'`)

    // Presence/typing: typing_at trên bảng read-tracking (updated_at của row = last seen)
    this.addSql(`ALTER TABLE mkt_channel_read ADD COLUMN IF NOT EXISTS typing_at TIMESTAMPTZ NULL`)

    // Quick Reply templates dùng chung cho team
    this.addSql(`
      CREATE TABLE IF NOT EXISTS mkt_chat_template (
        id TEXT NOT NULL,
        label TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT mkt_chat_template_pkey PRIMARY KEY (id)
      )
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS mkt_chat_template`)
    this.addSql(`ALTER TABLE mkt_channel_read DROP COLUMN IF EXISTS typing_at`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS priority`)
    this.addSql(`ALTER TABLE mkt_task DROP COLUMN IF EXISTS tags`)
  }
}
