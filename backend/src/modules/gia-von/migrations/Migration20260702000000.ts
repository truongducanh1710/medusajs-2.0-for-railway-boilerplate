import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260702000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS cpqc_target (
        id                VARCHAR PRIMARY KEY,
        product_code      VARCHAR,
        product_name      VARCHAR NOT NULL,
        from_date         DATE,
        to_date           DATE,
        avg_selling_price NUMERIC NOT NULL DEFAULT 0,
        cost_don1         NUMERIC NOT NULL DEFAULT 0,
        cost_don2         NUMERIC NOT NULL DEFAULT 0,
        cost_don3         NUMERIC NOT NULL DEFAULT 0,
        pct_don1          NUMERIC NOT NULL DEFAULT 0,
        pct_don2          NUMERIC NOT NULL DEFAULT 0,
        pct_don3          NUMERIC NOT NULL DEFAULT 0,
        return_rate       NUMERIC NOT NULL DEFAULT 0,
        ship_fee          NUMERIC NOT NULL DEFAULT 0,
        cod_fee_pct       NUMERIC NOT NULL DEFAULT 0,
        packing_fee       NUMERIC NOT NULL DEFAULT 0,
        target_margin_pct NUMERIC NOT NULL DEFAULT 0,
        exchange_rate     NUMERIC NOT NULL DEFAULT 24000,
        created_by        VARCHAR,
        created_at        TIMESTAMPTZ DEFAULT now()
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS cpqc_target_product_code_idx ON cpqc_target (product_code, created_at DESC);`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS cpqc_target;`)
  }
}
