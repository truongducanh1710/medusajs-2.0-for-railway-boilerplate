import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260527120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "web_session" (
        "id"              text not null,
        "visitor_id"      text not null,
        "session_id"      text not null,
        "first_seen"      timestamptz not null default now(),
        "last_seen"       timestamptz not null default now(),
        "current_url"     text not null default '',
        "referrer"        text not null default '',
        "utm_source"      text not null default '',
        "utm_medium"      text not null default '',
        "utm_campaign"    text not null default '',
        "utm_content"     text not null default '',
        "utm_term"        text not null default '',
        "device_type"     text not null default '',
        "user_agent"      text not null default '',
        "ip"              text not null default '',
        "province"        text not null default '',
        "has_cart"        boolean not null default false,
        "cart_id"         text null,
        "pageview_count"  integer not null default 0,
        "created_at"      timestamptz not null default now(),
        "updated_at"      timestamptz not null default now(),
        "deleted_at"      timestamptz null,
        constraint "web_session_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "web_session_visitor_id_idx" on "web_session" ("visitor_id");`)
    this.addSql(`create index if not exists "web_session_last_seen_idx" on "web_session" ("last_seen" desc);`)
    this.addSql(`create unique index if not exists "web_session_visitor_session_uniq" on "web_session" ("visitor_id", "session_id") where deleted_at is null;`)

    this.addSql(`
      create table if not exists "web_pageview" (
        "id"                  text not null,
        "visitor_id"          text not null,
        "session_id"          text not null,
        "url"                 text not null default '',
        "title"               text not null default '',
        "referrer"            text not null default '',
        "utm_source"          text not null default '',
        "utm_campaign"        text not null default '',
        "time_on_prev_page"   integer not null default 0,
        "created_at"          timestamptz not null default now(),
        "updated_at"          timestamptz not null default now(),
        "deleted_at"          timestamptz null,
        constraint "web_pageview_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "web_pageview_visitor_id_idx" on "web_pageview" ("visitor_id", "created_at" desc);`)
    this.addSql(`create index if not exists "web_pageview_created_at_idx" on "web_pageview" ("created_at" desc);`)
    this.addSql(`create index if not exists "web_pageview_session_id_idx" on "web_pageview" ("session_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "web_pageview";`)
    this.addSql(`drop table if exists "web_session";`)
  }
}
