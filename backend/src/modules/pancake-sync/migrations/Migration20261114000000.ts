import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Chỉ số phân phối thêm cho chi phí ads theo ngày (camp: mkt_ads_cost, ad: mkt_ads_cost_ad).
 * Lấy cùng request insights đang có (lib/mkt-cost-levels.ts) — không thêm lượt gọi FB.
 *   reach / frequency       : reach + tần suất trong NGÀY đó (không cộng reach giữa các ngày/ad)
 *   link_clicks             : inline_link_clicks (CTR link, khác clicks = mọi click)
 *   video_3s                : actions[video_view] (lượt xem 3 giây → hook rate = video_3s / impressions)
 *   thruplay                : video_thruplay_watched_actions
 *   fb_purchases / _value   : actions/action_values loại mua hàng FB ghi nhận (omni_purchase → purchase → pixel)
 * Cột nullable, không default: ADD COLUMN tức thời; dòng cũ để NULL (= chưa đo, khác 0).
 */
export class Migration20261114000000 extends Migration {
  async up(): Promise<void> {
    for (const t of ["mkt_ads_cost", "mkt_ads_cost_ad"]) {
      this.addSql(`ALTER TABLE IF EXISTS ${t}
        ADD COLUMN IF NOT EXISTS reach BIGINT,
        ADD COLUMN IF NOT EXISTS frequency NUMERIC(10,4),
        ADD COLUMN IF NOT EXISTS link_clicks BIGINT,
        ADD COLUMN IF NOT EXISTS video_3s BIGINT,
        ADD COLUMN IF NOT EXISTS thruplay BIGINT,
        ADD COLUMN IF NOT EXISTS fb_purchases INTEGER,
        ADD COLUMN IF NOT EXISTS fb_purchase_value BIGINT`)
    }
  }

  async down(): Promise<void> {
    for (const t of ["mkt_ads_cost", "mkt_ads_cost_ad"]) {
      this.addSql(`ALTER TABLE IF EXISTS ${t}
        DROP COLUMN IF EXISTS reach,
        DROP COLUMN IF EXISTS frequency,
        DROP COLUMN IF EXISTS link_clicks,
        DROP COLUMN IF EXISTS video_3s,
        DROP COLUMN IF EXISTS thruplay,
        DROP COLUMN IF EXISTS fb_purchases,
        DROP COLUMN IF EXISTS fb_purchase_value`)
    }
  }
}
