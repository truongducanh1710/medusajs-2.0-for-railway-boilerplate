import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260806000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `CREATE TABLE IF NOT EXISTS product_test_case (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, product_name TEXT NOT NULL, product_handle TEXT NULL, marketer_email TEXT NOT NULL, marketer_name TEXT NOT NULL, assignee_email TEXT NOT NULL, assignee_name TEXT NOT NULL, purchaser_email TEXT NULL, purchaser_name TEXT NULL, status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1, final_decision TEXT NULL, final_note TEXT NULL, decided_by TEXT NULL, decided_at TIMESTAMPTZ NULL, source_case_id TEXT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ NULL)`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_product_test_case_status ON product_test_case(status, created_at DESC)`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_product_test_case_marketer ON product_test_case(marketer_email, created_at DESC)`,
    );
    this.addSql(
      `CREATE TABLE IF NOT EXISTS product_purchase_check (id TEXT PRIMARY KEY, case_id TEXT NOT NULL UNIQUE REFERENCES product_test_case(id) ON DELETE CASCADE, supplier_link TEXT NULL, supplier_name TEXT NULL, description TEXT NULL, specification TEXT NULL, unit TEXT NULL, moq NUMERIC NULL, source_price NUMERIC NULL, currency TEXT NOT NULL DEFAULT 'CNY', exchange_rate NUMERIC NULL, weight_kg NUMERIC NULL, size TEXT NULL, quantity_per_carton NUMERIC NULL, shipping_fee NUMERIC NULL, other_cost NUMERIC NULL, landed_cost NUMERIC NULL, landed_price_per_unit NUMERIC NULL, conclusion TEXT NULL, note TEXT NULL, image_urls JSONB NOT NULL DEFAULT '[]', representative_image_url TEXT NULL, checked_by TEXT NULL, checked_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ NULL)`,
    );
    this.addSql(
      `CREATE TABLE IF NOT EXISTS product_test_proposal (id TEXT PRIMARY KEY, case_id TEXT NOT NULL UNIQUE REFERENCES product_test_case(id) ON DELETE CASCADE, usp TEXT NULL, combo_json TEXT NULL, sale_price NUMERIC NULL, gift_name TEXT NULL, promo_title TEXT NULL, ad_content TEXT NULL, reference_link TEXT NULL, landing_url TEXT NULL, note TEXT NULL, approved_by TEXT NULL, approved_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ NULL)`,
    );
    this.addSql(
      `CREATE TABLE IF NOT EXISTS product_test_daily_result (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES product_test_case(id) ON DELETE CASCADE, test_date TIMESTAMPTZ NOT NULL, tester_name TEXT NOT NULL, campaign_name TEXT NULL, ad_spend NUMERIC NULL, impressions NUMERIC NULL, clicks NUMERIC NULL, leads NUMERIC NULL, orders NUMERIC NULL, cancelled_orders NUMERIC NULL, revenue NUMERIC NULL, evaluation TEXT NULL, leader_note TEXT NULL, evaluated_by TEXT NULL, evaluated_at TIMESTAMPTZ NULL, version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ NULL)`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_product_test_daily_case_date ON product_test_daily_result(case_id, test_date DESC)`,
    );
    this.addSql(
      `CREATE TABLE IF NOT EXISTS product_test_event (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES product_test_case(id) ON DELETE CASCADE, action TEXT NOT NULL, from_status TEXT NULL, to_status TEXT NULL, actor TEXT NOT NULL, comment TEXT NULL, snapshot JSONB NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ NULL)`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_product_test_event_case ON product_test_event(case_id, created_at DESC)`,
    );
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS product_test_event`);
    this.addSql(`DROP TABLE IF EXISTS product_test_daily_result`);
    this.addSql(`DROP TABLE IF EXISTS product_test_proposal`);
    this.addSql(`DROP TABLE IF EXISTS product_purchase_check`);
    this.addSql(`DROP TABLE IF EXISTS product_test_case`);
  }
}
