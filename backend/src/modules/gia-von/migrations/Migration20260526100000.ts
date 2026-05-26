import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260526100000 extends Migration {
  async up(): Promise<void> {
    // parent_product_id: nếu lô này là phụ kiện, trỏ về product_id của SP chính
    this.addSql(`ALTER TABLE "import_lot" ADD COLUMN IF NOT EXISTS "parent_product_id" VARCHAR DEFAULT NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "import_lot_parent_product_id_idx" ON "import_lot" ("parent_product_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "import_lot" DROP COLUMN IF EXISTS "parent_product_id";`)
  }
}
