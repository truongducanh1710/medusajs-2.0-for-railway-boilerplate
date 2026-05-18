import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260518000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "import_lot" (
        "id"            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id"    VARCHAR NOT NULL,
        "product_title" VARCHAR NOT NULL,
        "lot_date"      VARCHAR(10) NOT NULL,
        "received_date" VARCHAR(10),
        "qty"           INT NOT NULL,
        "price_unit"    NUMERIC(14,2) NOT NULL,
        "amount"        NUMERIC(14,2) NOT NULL,
        "local_fee_tq"  NUMERIC(14,2) NOT NULL DEFAULT 0,
        "ship_fee_ovs"  NUMERIC(14,2) NOT NULL DEFAULT 0,
        "local_fee_vn"  NUMERIC(14,2) NOT NULL DEFAULT 0,
        "vat_fee"       NUMERIC(14,2) NOT NULL DEFAULT 0,
        "other_fee"     NUMERIC(14,2) NOT NULL DEFAULT 0,
        "final_price"   NUMERIC(14,2) NOT NULL,
        "source"        VARCHAR(50) NOT NULL DEFAULT 'TQ',
        "status"        VARCHAR(30) NOT NULL DEFAULT 'received',
        "note"          TEXT NOT NULL DEFAULT '',
        "created_by"    VARCHAR,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "import_lot_product_id_idx" ON "import_lot" ("product_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "import_lot_lot_date_idx" ON "import_lot" ("lot_date");`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "product_cost" (
        "id"               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id"       VARCHAR NOT NULL,
        "product_title"    VARCHAR NOT NULL,
        "avg_cost"         NUMERIC(14,2) NOT NULL DEFAULT 0,
        "stock_qty"        INT NOT NULL DEFAULT 0,
        "total_lots"       INT NOT NULL DEFAULT 0,
        "last_imported_at" VARCHAR(10),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "product_cost_product_id_uq" ON "product_cost" ("product_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "import_lot";`)
    this.addSql(`DROP TABLE IF EXISTS "product_cost";`)
  }
}
