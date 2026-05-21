import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260521000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "pancake_cron_log" (
        "id" text not null,
        "run_type" text not null default 'active',
        "started_at" timestamptz not null,
        "finished_at" timestamptz null,
        "duration_ms" integer null,
        "statuses" jsonb not null default '[]',
        "total_orders" integer not null default 0,
        "total_updated" integer not null default 0,
        "total_created" integer not null default 0,
        "total_errors" integer not null default 0,
        "error_details" jsonb not null default '[]',
        "success" boolean not null default true,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "pancake_webhook_log" (
        "id" text not null,
        "received_at" timestamptz not null,
        "pancake_order_id" text not null default '',
        "pancake_status" integer null,
        "status_name" text not null default '',
        "event_type" text not null default 'order',
        "api_fetch_success" boolean null,
        "upsert_success" boolean null,
        "fallback_used" boolean not null default false,
        "error_message" text null,
        "duration_ms" integer null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        primary key ("id")
      );
    `)

    this.addSql(`create index if not exists "pancake_cron_log_started_at_idx" on "pancake_cron_log" ("started_at" desc);`)
    this.addSql(`create index if not exists "pancake_webhook_log_received_at_idx" on "pancake_webhook_log" ("received_at" desc);`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "pancake_cron_log";`)
    this.addSql(`drop table if exists "pancake_webhook_log";`)
  }
}
