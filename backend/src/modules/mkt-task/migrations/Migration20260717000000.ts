import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260717000000 extends Migration {
  async up(): Promise<void> {
    // reply_to_id luôn trỏ về tin gốc của thread (dùng để gộp reply_count).
    // reply_parent_id lưu đúng tin nhắn user đã bấm "Trả lời" — dùng để hiển thị
    // ô quote đúng nội dung, tránh nhầm hiện tin gốc thread khi reply 1 tin giữa thread.
    this.addSql(`alter table if exists "mkt_message" add column if not exists "reply_parent_id" text null;`)
    this.addSql(`update "mkt_message" set "reply_parent_id" = "reply_to_id" where "reply_parent_id" is null and "reply_to_id" is not null;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table if exists "mkt_message" drop column if exists "reply_parent_id";`)
  }
}
