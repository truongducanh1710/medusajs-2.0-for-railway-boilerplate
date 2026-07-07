import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260707020000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS ity_extension_map (
        id TEXT PRIMARY KEY,
        extension TEXT NOT NULL UNIQUE,
        user_id TEXT,
        display_name TEXT NOT NULL DEFAULT '',
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );

      -- Seed mapping đã xác nhận thủ công từ trang quản trị ITY (2026-07-07)
      INSERT INTO ity_extension_map (id, extension, user_id, display_name, created_at, updated_at) VALUES
        ('01ITYEXT0000000000000001', '207491001', 'user_01KRN6834J2Z7CMFH7CV6PPT6F', 'Tu Linh', now(), now()),
        ('01ITYEXT0000000000000002', '207491002', 'user_01KRNJV8F600E53SXRPMNZF816', 'ChaMan', now(), now()),
        ('01ITYEXT0000000000000003', '207491003', 'user_01KWK0K67QX8TDDM2X45EQDHF8', 'Đỗ Quỳnh', now(), now()),
        ('01ITYEXT0000000000000004', '207491004', 'user_01KRWMYFZ8JCJK0QK653BDB812', 'Nguyễn Kiều Ly', now(), now())
      ON CONFLICT (extension) DO NOTHING;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS ity_extension_map;`)
  }
}
