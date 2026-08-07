import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Links a mkt_task to the product-test case it tracks, so the product-test
// workflow can find "is there already an open task for this case" instead
// of creating a duplicate on every status transition.
export class Migration20260807020000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE mkt_task ADD COLUMN IF NOT EXISTS product_test_case_id TEXT NULL`,
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_mkt_task_product_test_case ON mkt_task(product_test_case_id) WHERE product_test_case_id IS NOT NULL`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS idx_mkt_task_product_test_case`)
    this.addSql(
      `ALTER TABLE mkt_task DROP COLUMN IF EXISTS product_test_case_id`,
    )
  }
}
