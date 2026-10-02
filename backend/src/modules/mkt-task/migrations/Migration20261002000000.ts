import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Khung giờ được phép chấm công: sớm nhất checkin_open (trừ khi có lịch tăng ca),
// khoá hẳn từ checkin_cutoff. Xem cham-cong-config.ts.
export class Migration20261002000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE cham_cong_config ADD COLUMN IF NOT EXISTS checkin_open TEXT NOT NULL DEFAULT '08:00'`)
    this.addSql(`ALTER TABLE cham_cong_config ADD COLUMN IF NOT EXISTS checkin_cutoff TEXT NOT NULL DEFAULT '21:00'`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE cham_cong_config DROP COLUMN IF EXISTS checkin_cutoff`)
    this.addSql(`ALTER TABLE cham_cong_config DROP COLUMN IF EXISTS checkin_open`)
  }
}
