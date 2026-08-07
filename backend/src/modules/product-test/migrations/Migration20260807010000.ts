import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260807010000 extends Migration {
  async up(): Promise<void> {
    // Absolute uniqueness on product name, case/whitespace-insensitive.
    // Only live (non-deleted) cases participate, so a deleted case's name
    // never blocks reusing it later.
    this.addSql(
      `ALTER TABLE product_test_case ADD COLUMN IF NOT EXISTS product_name_key TEXT
       GENERATED ALWAYS AS (lower(trim(product_name))) STORED`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_product_test_case_name
       ON product_test_case(product_name_key) WHERE deleted_at IS NULL`,
    );
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS uq_product_test_case_name`);
    this.addSql(
      `ALTER TABLE product_test_case DROP COLUMN IF EXISTS product_name_key`,
    );
  }
}
