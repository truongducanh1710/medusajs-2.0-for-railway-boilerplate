import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Fix: ity_cdr_sync_job.id được tạo sai kiểu UUID ở migration trước — Medusa model.id()
// luôn sinh ULID string (vd "01KWXA..."), không phải UUID, nên insert bị lỗi
// "invalid input syntax for type uuid". Đổi cột id sang TEXT giống pancake_sync_job.
export class Migration20260707010000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE ity_cdr_sync_job ALTER COLUMN id DROP DEFAULT;
      ALTER TABLE ity_cdr_sync_job ALTER COLUMN id TYPE TEXT USING id::text;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE ity_cdr_sync_job ALTER COLUMN id TYPE UUID USING id::uuid;
      ALTER TABLE ity_cdr_sync_job ALTER COLUMN id SET DEFAULT gen_random_uuid();
    `)
  }
}
