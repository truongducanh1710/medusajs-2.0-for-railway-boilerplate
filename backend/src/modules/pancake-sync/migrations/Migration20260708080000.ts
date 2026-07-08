import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260708080000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      -- Backfill ad_platform bị bỏ sót từ 06/07/2026: model pancake_order thiếu khai báo
      -- ad_platform/fb_campaign_id nên MedusaService không ghi 2 field này khi create/update,
      -- dù cột đã tồn tại và service.ts đã tính giá trị đúng (xem mapPancakeOrder).
      -- Bắt các marker Google mà migration backfill trước (20260706000000) còn thiếu:
      -- gad_campaignid, wbraid (chỉ check gclid/gbraid/gad_source).
      UPDATE pancake_order
      SET ad_platform = 'google'
      WHERE ad_platform IS NULL
        AND raw IS NOT NULL
        AND (
          raw::text ILIKE '%"ads_source":"Google"%'
          OR raw::text ILIKE '%gclid=%'
          OR raw::text ILIKE '%gbraid=%'
          OR raw::text ILIKE '%wbraid=%'
          OR raw::text ILIKE '%gad_source=%'
          OR raw::text ILIKE '%gad_campaignid=%'
        );

      UPDATE pancake_order
      SET ad_platform = 'facebook'
      WHERE ad_platform IS NULL
        AND fb_campaign_id IS NOT NULL;
    `)
  }

  async down(): Promise<void> {
    // Không revert — backfill chỉ điền field còn thiếu, không có dữ liệu gốc để khôi phục về NULL an toàn.
  }
}
