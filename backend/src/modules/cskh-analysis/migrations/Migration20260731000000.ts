import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Bang ke hoach doanh so (target) theo NGAY x NEN TANG cho tung thi truong.
 *
 * Grain: (date, market, platform) — mot dong = target cua 1 nen tang trong 1 ngay.
 *   VN: facebook | tiktok | shopee     (facebook = phan con lai sau khi tru 2 san)
 *   MY: tiktok   | shopee
 *
 * amount luu don vi VND cho ca 2 thi truong (MY da quy doi san khi nhap) de
 * cong tong 2 thi truong khong phai xu ly ty gia luc doc — ty gia bien dong se
 * khong lam thay doi ke hoach da chot.
 *
 * Doi chieu voi doanh so thuc: dung cod_amount (giong report/route.ts), khong
 * phai `total` truoc khuyen mai.
 */
export class Migration20260731000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS mkt_revenue_target (
        id          SERIAL PRIMARY KEY,
        date        DATE         NOT NULL,
        market      VARCHAR(8)   NOT NULL,
        platform    VARCHAR(24)  NOT NULL,
        amount      BIGINT       NOT NULL DEFAULT 0,
        updated_by  VARCHAR(120),
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `)
    // Upsert key — moi (ngay, thi truong, nen tang) chi co dung 1 dong.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS mkt_revenue_target_key_idx
        ON mkt_revenue_target (date, market, platform);
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS mkt_revenue_target_date_idx
        ON mkt_revenue_target (date);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS mkt_revenue_target;`)
  }
}
