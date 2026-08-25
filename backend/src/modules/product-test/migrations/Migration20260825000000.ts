import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260825000000 extends Migration {
  async up(): Promise<void> {
    // Đánh giá của MKT cho từng ngày test, tách hẳn khỏi evaluation/leader_note
    // của leader: MKT là người chạy camp nên thấy trước tín hiệu nên test tiếp
    // hay dừng, leader nhìn vào đó để chốt nhập/không nhập.
    this.addSql(`
      ALTER TABLE product_test_daily_result
        ADD COLUMN IF NOT EXISTS mkt_decision TEXT NULL,
        ADD COLUMN IF NOT EXISTS mkt_note TEXT NULL,
        ADD COLUMN IF NOT EXISTS mkt_decided_by TEXT NULL,
        ADD COLUMN IF NOT EXISTS mkt_decided_at TIMESTAMPTZ NULL
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE product_test_daily_result
        DROP COLUMN IF EXISTS mkt_decision,
        DROP COLUMN IF EXISTS mkt_note,
        DROP COLUMN IF EXISTS mkt_decided_by,
        DROP COLUMN IF EXISTS mkt_decided_at
    `);
  }
}
