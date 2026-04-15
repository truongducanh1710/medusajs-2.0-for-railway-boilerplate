import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260415000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `create table if not exists "page" ("id" text not null, "title" text not null, "slug" text not null, "content" text not null default '{}', "status" text not null default 'draft', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "page_pkey" primary key ("id"));`
    )
    this.addSql(`create unique index if not exists "page_slug_unique" on "page" ("slug") where deleted_at is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "page" cascade;`)
  }
}
