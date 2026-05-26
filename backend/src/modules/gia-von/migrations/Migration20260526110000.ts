import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260526110000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "product_cost" ADD COLUMN IF NOT EXISTS "pancake_display_id" VARCHAR DEFAULT NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "product_cost_pancake_display_id_uq" ON "product_cost" ("pancake_display_id") WHERE "pancake_display_id" IS NOT NULL;`)

    // Auto-fill các SP đã match được theo tên
    this.addSql(`
      UPDATE product_cost pc
      SET pancake_display_id = sub.display_id
      FROM (
        SELECT DISTINCT ON (UPPER(TRIM(item->'variation_info'->>'name')))
          UPPER(TRIM(item->'variation_info'->>'name')) as norm_name,
          item->'variation_info'->>'display_id' as display_id
        FROM pancake_order, jsonb_array_elements(raw->'items') as item
        WHERE raw->'items' IS NOT NULL
          AND item->'variation_info'->>'display_id' IS NOT NULL
        ORDER BY UPPER(TRIM(item->'variation_info'->>'name')), display_id
      ) sub
      WHERE UPPER(TRIM(pc.product_title)) = sub.norm_name
        AND pc.pancake_display_id IS NULL
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "product_cost_pancake_display_id_uq";`)
    this.addSql(`ALTER TABLE "product_cost" DROP COLUMN IF EXISTS "pancake_display_id";`)
  }
}
