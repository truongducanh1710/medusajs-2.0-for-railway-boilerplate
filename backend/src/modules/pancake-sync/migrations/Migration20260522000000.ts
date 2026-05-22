import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260522000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `create table if not exists "webcake_lead" (
        "id"           text not null,
        "full_name"    text not null default '',
        "phone_number" text not null default '',
        "raw"          jsonb not null default '{}'::jsonb,
        "status"       text not null default 'new',
        "source_url"   text not null default '',
        "created_at"   timestamptz not null default now(),
        "updated_at"   timestamptz not null default now(),
        "deleted_at"   timestamptz null,
        constraint "webcake_lead_pkey" primary key ("id")
      );`
    )
    this.addSql(
      `create index if not exists "webcake_lead_phone_idx" on "webcake_lead" ("phone_number");`
    )
    this.addSql(
      `create index if not exists "webcake_lead_created_at_idx" on "webcake_lead" ("created_at" desc);`
    )
    this.addSql(
      `create index if not exists "webcake_lead_status_idx" on "webcake_lead" ("status");`
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "webcake_lead" cascade;`)
  }
}
