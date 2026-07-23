import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Cho phép sửa nội dung tin nhắn (PATCH /messages/:id) — trước đây chỉ có DELETE
// (thu hồi). Cần cho agent AI cập nhật 1 tin duy nhất theo tiến độ ("Đang xử lý..."
// → "Xong · 2 bước") thay vì spam nhiều tin riêng cho mỗi bước. edited_at đánh dấu tin
// đã bị sửa — client hiện nhãn "(đã sửa)" để không ai nhầm là nội dung gốc.
export class Migration20260723000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_message ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE mkt_message DROP COLUMN IF EXISTS edited_at`)
  }
}
