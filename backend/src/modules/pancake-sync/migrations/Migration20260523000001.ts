import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260523000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "fb_ad_account" (
        "id" uuid not null default gen_random_uuid(),
        "account_id" varchar(32) not null,
        "account_name" text not null default '',
        "mkt_name" varchar(32) not null default '',
        "active" boolean not null default true,
        "note" text not null default '',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        primary key ("id"),
        unique ("account_id")
      );
    `)
    this.addSql(`create index if not exists "idx_fb_ad_account_active" on "fb_ad_account" ("active") where deleted_at is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "fb_ad_account";`)
  }
}
