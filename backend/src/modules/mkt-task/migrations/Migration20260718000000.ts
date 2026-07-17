import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260718000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS cham_cong_config (
        id TEXT NOT NULL,
        shift_start TEXT NOT NULL DEFAULT '08:30',
        shift_end TEXT NOT NULL DEFAULT '17:30',
        work_days JSONB NOT NULL DEFAULT '[1,2,3,4,5,6]',
        late_grace_min INTEGER NOT NULL DEFAULT 5,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT cham_cong_config_pkey PRIMARY KEY (id)
      )
    `)
    this.addSql(`
      INSERT INTO cham_cong_config (id, shift_start, shift_end, work_days, late_grace_min)
      VALUES ('default', '08:30', '17:30', '[1,2,3,4,5,6]', 5)
      ON CONFLICT (id) DO NOTHING
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS cham_cong_config`)
  }
}
