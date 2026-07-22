import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Thêm 2 bảng cost ở level adset và ad, song song với mkt_ads_cost (campaign-level).
 * KHÔNG gộp vào mkt_ads_cost vì unique(date, campaign_id) — nhét ad-level vào sẽ
 * phá constraint, và mọi query SUM(spend) GROUP BY campaign_id hiện có sẽ cộng trùng.
 *
 * vd_code extract sẵn từ ad_name (regex VD\d+) để join thẳng mkt_video.
 */
export class Migration20260722000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "mkt_ads_cost_adset" (
        "id" uuid not null default gen_random_uuid(),
        "date" date not null,
        "mkt_name" varchar(32) not null default '',
        "ad_account_id" varchar(32) not null,
        "campaign_id" varchar(64) not null,
        "campaign_name" text not null default '',
        "adset_id" varchar(64) not null,
        "adset_name" text not null default '',
        "spend" bigint not null default 0,
        "impressions" integer not null default 0,
        "clicks" integer not null default 0,
        "effective_status" varchar(32) null,
        "daily_budget" bigint null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        primary key ("id"),
        unique ("date", "adset_id")
      );
    `)
    this.addSql(`create index if not exists "idx_mkt_ads_cost_adset_date_mkt" on "mkt_ads_cost_adset" ("date", "mkt_name");`)
    this.addSql(`create index if not exists "idx_mkt_ads_cost_adset_camp" on "mkt_ads_cost_adset" ("campaign_id", "date");`)

    this.addSql(`
      create table if not exists "mkt_ads_cost_ad" (
        "id" uuid not null default gen_random_uuid(),
        "date" date not null,
        "mkt_name" varchar(32) not null default '',
        "ad_account_id" varchar(32) not null,
        "campaign_id" varchar(64) not null,
        "campaign_name" text not null default '',
        "adset_id" varchar(64) not null default '',
        "adset_name" text not null default '',
        "ad_id" varchar(64) not null,
        "ad_name" text not null default '',
        "vd_code" varchar(32) null,
        "spend" bigint not null default 0,
        "impressions" integer not null default 0,
        "clicks" integer not null default 0,
        "effective_status" varchar(32) null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        primary key ("id"),
        unique ("date", "ad_id")
      );
    `)
    this.addSql(`create index if not exists "idx_mkt_ads_cost_ad_date_mkt" on "mkt_ads_cost_ad" ("date", "mkt_name");`)
    this.addSql(`create index if not exists "idx_mkt_ads_cost_ad_camp" on "mkt_ads_cost_ad" ("campaign_id", "date");`)
    this.addSql(`create index if not exists "idx_mkt_ads_cost_ad_vd" on "mkt_ads_cost_ad" ("vd_code", "date");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "mkt_ads_cost_ad";`)
    this.addSql(`drop table if exists "mkt_ads_cost_adset";`)
  }
}
