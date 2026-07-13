import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260713230000 extends Migration {
  async up(): Promise<void> {
    // --- dohana_video ---
    this.addSql(
      `create table if not exists "dohana_video" (
        "id"                text not null,
        "store_id"          text not null default '',
        "order_code"        text not null default '',
        "prepare_code"      text not null default '',
        "type"              text not null default '',
        "status"            text not null default '',
        "slug"              text not null default '',
        "duration"          integer not null default 0,
        "start_time"        timestamptz null,
        "user_email"        text not null default '',
        "user_name"         text not null default '',
        "drive_link"        text null,
        "deleted_timeline"  timestamptz null,
        "raw"               jsonb not null default '{}'::jsonb,
        "synced_at"         timestamptz not null default now(),
        "created_at"        timestamptz not null default now(),
        "updated_at"        timestamptz not null default now(),
        "deleted_at"        timestamptz null,
        constraint "dohana_video_pkey" primary key ("id")
      );`
    )

    this.addSql(
      `create index if not exists "dohana_video_start_time_idx"
        on "dohana_video" ("start_time" desc);`
    )
    this.addSql(
      `create index if not exists "dohana_video_status_idx"
        on "dohana_video" ("status");`
    )
    this.addSql(
      `create index if not exists "dohana_video_user_email_idx"
        on "dohana_video" ("user_email");`
    )
    this.addSql(
      `create index if not exists "dohana_video_order_code_idx"
        on "dohana_video" ("order_code");`
    )
    this.addSql(
      `create index if not exists "dohana_video_type_idx"
        on "dohana_video" ("type");`
    )

    // --- dohana_sync_job ---
    this.addSql(
      `create table if not exists "dohana_sync_job" (
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
        constraint "dohana_sync_job_pkey" primary key ("id")
      );`
    )

    this.addSql(
      `create index if not exists "dohana_sync_job_status_idx"
        on "dohana_sync_job" ("status");`
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "dohana_video" cascade;`)
    this.addSql(`drop table if exists "dohana_sync_job" cascade;`)
  }
}
