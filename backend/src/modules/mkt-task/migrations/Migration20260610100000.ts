import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260610100000 extends Migration {
  async up(): Promise<void> {
    // Thêm fields vào mkt_message
    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS reply_to_id TEXT NULL`)
    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS file_url TEXT NULL`)
    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS file_type TEXT NULL`)
    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS file_name TEXT NULL`)
    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS file_expires_at TIMESTAMPTZ NULL`)
    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'`)
    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE`)
    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'`)

    // Index cho pinned messages per channel
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_message_pinned_idx ON mkt_message (channel_id, is_pinned) WHERE deleted_at IS NULL AND is_pinned = TRUE`)

    // Bảng track last_read per user per channel (để tính unread count)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS mkt_channel_read (
        id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT mkt_channel_read_pkey PRIMARY KEY (id),
        CONSTRAINT mkt_channel_read_unique UNIQUE (channel_id, user_email)
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_channel_read_user_idx ON mkt_channel_read (user_email)`)

    // Bảng track file upload để cleanup job xoá hết hạn 7 ngày
    this.addSql(`
      CREATE TABLE IF NOT EXISTS mkt_chat_file (
        id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        file_key TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT mkt_chat_file_pkey PRIMARY KEY (id)
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS mkt_chat_file_expires_idx ON mkt_chat_file (expires_at)`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS mkt_chat_file`)
    this.addSql(`DROP TABLE IF EXISTS mkt_channel_read`)
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS reply_to_id`)
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS file_url`)
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS file_type`)
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS file_name`)
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS file_expires_at`)
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS reactions`)
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS is_pinned`)
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS mentions`)
  }
}
