import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260718020000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE cham_cong_config ADD COLUMN IF NOT EXISTS half_day_saturdays JSONB NOT NULL DEFAULT '[]'`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE cham_cong_config DROP COLUMN IF EXISTS half_day_saturdays`)
  }
}
