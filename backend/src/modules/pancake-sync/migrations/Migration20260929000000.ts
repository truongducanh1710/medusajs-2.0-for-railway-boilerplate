import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tính cả đơn web phanviet.vn (source = 'medusa') vào view đơn theo camp.
 *
 * Đơn đẩy từ Medusa sang Pancake có source 'medusa', không phải 'webcake'/'manual'
 * → camp chạy link web (vd PHVVN026CV_27/9_ANHTD_..._ADS327_COSTCAP200_WEB_4VID)
 * luôn hiện 0 đơn dù Pancake đã có đơn mang đúng UTM.
 */
export class Migration20260929000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE OR REPLACE VIEW v_camp_orders AS
        SELECT
          po.id, po.pancake_created_at::date AS date,
          po.cod_amount, po.status,
          po.raw->>'p_utm_source' AS utm_source,
          po.raw->>'p_utm_campaign' AS utm_campaign,
          po.raw->>'p_utm_medium' AS utm_medium
        FROM pancake_order po
        WHERE po.deleted_at IS NULL
          AND po.source IN ('manual','webcake','medusa')
          AND NOT (po.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
          AND NOT (po.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
          AND po.pancake_created_at >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 90;

      CREATE OR REPLACE VIEW v_shop_care_daily AS
        SELECT
          mac.date,
          SUM(mac.spend)::bigint AS total_spend,
          COALESCE(SUM(po.cod_amount), 0)::bigint AS total_cod,
          ROUND(SUM(mac.spend)::numeric / NULLIF(SUM(po.cod_amount), 0) * 100, 1) AS care_pct,
          COUNT(DISTINCT mac.campaign_id) AS active_camps,
          COUNT(DISTINCT po.id) AS order_count
        FROM mkt_ads_cost mac
        LEFT JOIN pancake_order po
          ON po.pancake_created_at::date = mac.date
          AND po.source IN ('manual','webcake','medusa')
          AND po.deleted_at IS NULL
          AND NOT (po.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
          AND NOT (po.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
        WHERE mac.deleted_at IS NULL
          AND mac.date >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 45
        GROUP BY mac.date
        ORDER BY mac.date DESC;
    `)
  }

  async down(): Promise<void> {}
}
