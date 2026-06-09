import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260610000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "mkt_channel" (
        "id" text not null,
        "name" text not null,
        "description" text null,
        "created_by" text not null,
        "members" jsonb not null default '[]',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "mkt_channel_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "mkt_task" (
        "id" text not null,
        "title" text not null,
        "type" text not null,
        "assignee_id" text not null,
        "created_by" text not null,
        "deadline" timestamptz null,
        "status" text not null default 'todo',
        "notes" text null,
        "comments" jsonb not null default '[]',
        "rating" integer null,
        "channel_id" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "mkt_task_pkey" primary key ("id")
      );
    `)

    this.addSql(`create index "mkt_task_assignee_idx" on "mkt_task" ("assignee_id") where deleted_at is null;`)
    this.addSql(`create index "mkt_task_status_idx" on "mkt_task" ("status") where deleted_at is null;`)

    this.addSql(`
      create table if not exists "mkt_message" (
        "id" text not null,
        "channel_id" text not null,
        "author_id" text not null,
        "content" text not null,
        "task_id" text null,
        "msg_type" text not null default 'text',
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "mkt_message_pkey" primary key ("id")
      );
    `)

    this.addSql(`create index "mkt_message_channel_idx" on "mkt_message" ("channel_id") where deleted_at is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "mkt_message" cascade;`)
    this.addSql(`drop table if exists "mkt_task" cascade;`)
    this.addSql(`drop table if exists "mkt_channel" cascade;`)
  }
}
