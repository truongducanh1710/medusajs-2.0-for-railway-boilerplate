import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Chia sẻ video nguyên liệu cho freelancer: mkt_video.shared_with = mảng email
 * (lower-case) được XEM video dù không phải người tạo. Chỉ xem + lấy link — quyền
 * sửa/xoá vẫn theo created_by, và video chia sẻ không tính vào báo cáo của họ.
 */
export class Migration20261015000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS mkt_video ADD COLUMN IF NOT EXISTS shared_with JSONB NOT NULL DEFAULT '[]'`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_mkt_video_shared_with ON mkt_video USING GIN (shared_with)`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS idx_mkt_video_shared_with`)
    this.addSql(`ALTER TABLE IF EXISTS mkt_video DROP COLUMN IF EXISTS shared_with`)
  }
}
