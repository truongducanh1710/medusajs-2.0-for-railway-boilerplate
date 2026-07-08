import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260708090000 extends Migration {
  async up(): Promise<void> {
    // mkt_ads_cost_gg ban đầu chỉ có 1 nguồn tổng/ngày (unique theo date).
    // Giờ mỗi marketer gắn 1 sheet Google Ads riêng (metadata.gg_ads_sheet_url trên user)
    // nên cần tách theo mkt_name, giống mkt_ads_cost (FB).
    this.addSql(`alter table "mkt_ads_cost_gg" add column if not exists "mkt_name" varchar(32);`)
    this.addSql(`update "mkt_ads_cost_gg" set "mkt_name" = 'KHÁC' where "mkt_name" is null;`)
    this.addSql(`alter table "mkt_ads_cost_gg" alter column "mkt_name" set not null;`)

    this.addSql(`alter table "mkt_ads_cost_gg" drop constraint if exists "mkt_ads_cost_gg_date_key";`)
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint where conname = 'mkt_ads_cost_gg_date_mkt_name_unique'
        ) then
          alter table "mkt_ads_cost_gg" add constraint "mkt_ads_cost_gg_date_mkt_name_unique" unique ("date", "mkt_name");
        end if;
      end $$;
    `)

    this.addSql(`drop index if exists "idx_mkt_ads_cost_gg_date";`)
    this.addSql(`create index if not exists "idx_mkt_ads_cost_gg_date_mkt" on "mkt_ads_cost_gg" ("date", "mkt_name");`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "mkt_ads_cost_gg" drop constraint if exists "mkt_ads_cost_gg_date_mkt_name_unique";`)
    this.addSql(`drop index if exists "idx_mkt_ads_cost_gg_date_mkt";`)
    this.addSql(`alter table "mkt_ads_cost_gg" drop column if exists "mkt_name";`)
    this.addSql(`alter table "mkt_ads_cost_gg" add constraint "mkt_ads_cost_gg_date_key" unique ("date");`)
    this.addSql(`create index if not exists "idx_mkt_ads_cost_gg_date" on "mkt_ads_cost_gg" ("date");`)
  }
}
