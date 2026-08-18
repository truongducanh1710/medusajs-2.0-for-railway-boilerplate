import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Chi phí quảng cáo sàn TMĐT (TikTok Shop / Shopee) điền tay theo ngày.
 *
 * Sàn không có API lấy spend như Facebook, cũng không có sheet sync như Google Ads —
 * nhân sự đang ghi tay vào Google Sheet ngoài hệ thống nên báo cáo LNG sàn không trừ
 * được chi phí ads. Bảng này để nhập thẳng trong app.
 *
 * Grain (date, platform): 1 con số tổng mỗi ngày cho mỗi sàn.
 */
export class Migration20260818000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "mkt_ads_cost_marketplace" (
        "id"         uuid not null default gen_random_uuid(),
        "date"       date not null,
        "platform"   varchar(16) not null,      -- 'tiktok' | 'shopee'
        "market"     varchar(8)  not null default 'VN',   -- 'VN' | 'MY'
        "shop"       varchar(64) not null default '',     -- shop_name; '' = gộp cả thị trường
        "cost"       bigint not null default 0,  -- LUÔN quy về VNĐ (đơn MY lưu RM, nhập tay đã quy đổi)
        "note"       text,
        "created_by" varchar(255),
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        primary key ("id"),
        constraint "mkt_ads_cost_marketplace_uniq" unique ("date", "platform", "market", "shop")
      );
    `)
    this.addSql(`
      create index if not exists "idx_mkt_ads_cost_mp_date"
        on "mkt_ads_cost_marketplace" ("date", "platform", "market");
    `)

    // Bảng có thể đã tạo ở bản trước (chỉ date+platform) — nâng cấp tại chỗ cho môi
    // trường đã deploy, tránh phải xoá dữ liệu đã nhập.
    this.addSql(`alter table "mkt_ads_cost_marketplace" add column if not exists "market" varchar(8) not null default 'VN';`)
    this.addSql(`alter table "mkt_ads_cost_marketplace" add column if not exists "shop" varchar(64) not null default '';`)
    this.addSql(`alter table "mkt_ads_cost_marketplace" drop constraint if exists "mkt_ads_cost_marketplace_date_platform_unique";`)
    this.addSql(`
      do $$
      begin
        if not exists (select 1 from pg_constraint where conname = 'mkt_ads_cost_marketplace_uniq') then
          alter table "mkt_ads_cost_marketplace"
            add constraint "mkt_ads_cost_marketplace_uniq" unique ("date", "platform", "market", "shop");
        end if;
      end $$;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "mkt_ads_cost_marketplace";`)
  }
}
