import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260708000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "mkt_ads_cost_gg" (
        "id" uuid not null default gen_random_uuid(),
        "date" date not null,
        "impressions" integer not null default 0,
        "clicks" integer not null default 0,
        "ctr" numeric,
        "avg_cpc" bigint,
        "conversions" numeric not null default 0,
        "cost_per_conv" bigint,
        "cost" bigint not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        primary key ("id"),
        unique ("date")
      );
    `)
    this.addSql(`create index if not exists "idx_mkt_ads_cost_gg_date" on "mkt_ads_cost_gg" ("date");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "mkt_ads_cost_gg";`)
  }
}
