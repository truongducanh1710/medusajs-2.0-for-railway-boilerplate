import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260513000000 extends Migration {
  async up(): Promise<void> {
    // --- pancake_order ---
    this.addSql(
      `create table if not exists "pancake_order" (
        "id"               text not null,
        "medusa_order_id"  text null,
        "source"           text not null default 'unknown',
        "status"           integer not null default 0,
        "status_name"      text not null default '',
        "status_history"   jsonb not null default '[]'::jsonb,
        "customer_name"    text not null default '',
        "customer_phone"   text not null default '',
        "province"         text not null default '',
        "total"            numeric not null default 0,
        "shipping_fee"     numeric not null default 0,
        "cod_amount"       numeric not null default 0,
        "items"            jsonb not null default '[]'::jsonb,
        "items_count"      integer not null default 0,
        "tracking_code"    text not null default '',
        "currency"         text not null default 'VND',
        "raw"              jsonb not null default '{}'::jsonb,
        "raw_version"      text not null default 'v1',
        "data_quality"     text not null default 'complete',
        "pancake_created_at" timestamptz null,
        "synced_at"        timestamptz not null default now(),
        "created_at"       timestamptz not null default now(),
        "updated_at"       timestamptz not null default now(),
        "deleted_at"       timestamptz null,
        constraint "pancake_order_pkey" primary key ("id")
      );`
    )

    // Partial unique: 1 Medusa order ↔ 1 Pancake order
    this.addSql(
      `create unique index if not exists "pancake_order_medusa_id_uniq"
        on "pancake_order" ("medusa_order_id")
        where medusa_order_id is not null;`
    )

    // Filter/sort indexes
    this.addSql(
      `create index if not exists "pancake_order_created_at_idx"
        on "pancake_order" ("pancake_created_at" desc);`
    )
    this.addSql(
      `create index if not exists "pancake_order_status_idx"
        on "pancake_order" ("status");`
    )
    this.addSql(
      `create index if not exists "pancake_order_source_idx"
        on "pancake_order" ("source");`
    )
    this.addSql(
      `create index if not exists "pancake_order_phone_idx"
        on "pancake_order" ("customer_phone");`
    )
    this.addSql(
      `create index if not exists "pancake_order_source_created_idx"
        on "pancake_order" ("source", "pancake_created_at" desc);`
    )

    // --- pancake_sync_job ---
    this.addSql(
      `create table if not exists "pancake_sync_job" (
        "id"          text not null,
        "status"      text not null default 'queued',
        "from_date"   timestamptz not null,
        "to_date"     timestamptz not null,
        "started_at"  timestamptz null,
        "finished_at" timestamptz null,
        "stats"       jsonb not null default '{}'::jsonb,
        "error"       text null,
        "created_at"  timestamptz not null default now(),
        "updated_at"  timestamptz not null default now(),
        "deleted_at"  timestamptz null,
        constraint "pancake_sync_job_pkey" primary key ("id")
      );`
    )

    this.addSql(
      `create index if not exists "pancake_sync_job_status_idx"
        on "pancake_sync_job" ("status");`
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "pancake_order" cascade;`)
    this.addSql(`drop table if exists "pancake_sync_job" cascade;`)
  }
}
