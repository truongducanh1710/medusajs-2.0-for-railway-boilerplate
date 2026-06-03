import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Đảm bảo sequence mkt_video_vd_seq tồn tại (fix trường hợp Migration20260604000001
 * đã tạo table nhưng chưa tạo sequence, hoặc sequence bị thiếu vì lý do nào đó).
 */
export class Migration20260604000002 extends Migration {
  async up(): Promise<void> {
    this.addSql(`CREATE SEQUENCE IF NOT EXISTS mkt_video_vd_seq START 1001`)
  }

  async down(): Promise<void> {
    // Không drop sequence vì mkt_video phụ thuộc vào nó
  }
}
