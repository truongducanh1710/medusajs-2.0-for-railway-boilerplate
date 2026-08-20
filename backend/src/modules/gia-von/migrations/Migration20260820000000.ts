import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Thêm created_at cho dòng bảng giá vốn.
 *
 * Bảng chỉ có updated_at nên không biết dòng được thêm lúc nào — mỗi lần sửa ô là
 * updated_at nhảy, không truy được ai vừa nhập gì. Cột mới do hệ thống tự điền,
 * UI không cho sửa.
 *
 * Dòng CŨ để NULL chứ không đặt now(): gán ngày hôm nay cho 110 dòng nhập từ tháng 6
 * là bịa dữ liệu. UI hiện ô trống cho các dòng đó.
 */
export class Migration20260820000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE cost_sheet_row ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;`)
    // Dòng thêm từ nay về sau tự có ngày tạo.
    this.addSql(`ALTER TABLE cost_sheet_row ALTER COLUMN created_at SET DEFAULT now();`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE cost_sheet_row DROP COLUMN IF EXISTS created_at;`)
  }
}
