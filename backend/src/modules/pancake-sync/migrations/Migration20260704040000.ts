import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Thêm cột `shop_name` — tên gian hàng TikTok con (Malaysia có nhiều shop TikTok dưới cùng
 * shop_id Pancake, phân biệt qua raw.page.name, vd "PhanViet Skincare", "Phanviet-Store.my").
 * Backfill từ raw cho đơn MY hiện có. VN không dùng (để trống).
 */
export class Migration20260704040000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE pancake_order ADD COLUMN IF NOT EXISTS shop_name VARCHAR(128) DEFAULT ''`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_pancake_order_shop_name ON pancake_order (market, shop_name, pancake_created_at)`)
    // Backfill từ raw->page->name cho đơn market=MY đã sync trước đó
    this.addSql(`UPDATE pancake_order
                 SET shop_name = COALESCE(raw->'page'->>'name', '')
                 WHERE market = 'MY' AND (shop_name IS NULL OR shop_name = '')
                   AND raw->'page'->>'name' IS NOT NULL`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS idx_pancake_order_shop_name`)
    this.addSql(`ALTER TABLE pancake_order DROP COLUMN IF EXISTS shop_name`)
  }
}
