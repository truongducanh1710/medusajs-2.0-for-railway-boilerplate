import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260717010000 extends Migration {
  async up(): Promise<void> {
    // Thu hồi tin nhắn: giữ nguyên row (khác deleted_at) để hiện placeholder
    // "đã thu hồi" đúng vị trí trong luồng chat, không xoá hẳn như soft-delete.
    this.addSql(`alter table if exists "mkt_message" add column if not exists "recalled_at" timestamptz null;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table if exists "mkt_message" drop column if exists "recalled_at";`)
  }
}
