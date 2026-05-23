import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260523000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "mkt_ads_cost" (
        "id" uuid not null default gen_random_uuid(),
        "date" date not null,
        "mkt_name" varchar(32) not null,
        "ad_account_id" varchar(32) not null,
        "campaign_id" varchar(64) not null,
        "campaign_name" text not null,
        "spend" bigint not null default 0,
        "impressions" integer not null default 0,
        "clicks" integer not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        primary key ("id"),
        unique ("date", "campaign_id")
      );
    `)
    this.addSql(`create index if not exists "idx_mkt_ads_cost_date_mkt" on "mkt_ads_cost" ("date", "mkt_name");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "mkt_ads_cost";`)
  }
}
