import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260709010000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_chat_file ADD COLUMN IF NOT EXISTS cleaned_at TIMESTAMPTZ NULL`)
    this.addSql(`DROP INDEX IF EXISTS mkt_chat_file_expires_idx`)
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_chat_file_expires_idx ON mkt_chat_file (expires_at) WHERE cleaned_at IS NULL`)

    this.addSql(`ALTER TABLE mkt_channel ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false`)

    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0`)
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_message_reply_to_idx ON mkt_message (reply_to_id) WHERE reply_to_id IS NOT NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS mkt_message_reply_to_idx`)
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS reply_count`)
    this.addSql(`ALTER TABLE mkt_channel DROP COLUMN IF EXISTS is_private`)

    this.addSql(`DROP INDEX IF EXISTS mkt_chat_file_expires_idx`)
    this.addSql(`ALTER TABLE mkt_chat_file DROP COLUMN IF EXISTS cleaned_at`)
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_chat_file_expires_idx ON mkt_chat_file (expires_at)`)
  }
}