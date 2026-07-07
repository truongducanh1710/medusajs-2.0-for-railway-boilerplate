import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Fix bug timezone: code cũ parse "calldate" của ITY (giờ VN, không suffix timezone)
// bằng `new Date(str)` — Node hiểu chuỗi không suffix là UTC, nên giờ VN thật bị lưu
// nhầm làm giờ UTC (sớm hơn UTC thật 7 tiếng). Ví dụ "11:45 VN" (= 04:45 UTC thật)
// bị lưu thành "11:45 UTC" — khiến calldate hiển thị lệch 7 tiếng "trong tương lai".
// Trừ lại 7 tiếng cho toàn bộ record cũ để calldate phản ánh đúng thời điểm UTC thật.
export class Migration20260707030000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      UPDATE ity_cdr_call SET calldate = calldate - INTERVAL '7 hours';
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      UPDATE ity_cdr_call SET calldate = calldate + INTERVAL '7 hours';
    `)
  }
}
