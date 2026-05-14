import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260515000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "pancake_order"
        add column if not exists "notes"        jsonb not null default '[]',
        add column if not exists "last_note_at" timestamptz,
        add column if not exists "call_count"   integer not null default 0,
        add column if not exists "tags"         jsonb not null default '[]';
    `)
    // Index để query nhanh đơn chưa có note và đơn trong khoảng ngày
    this.addSql(`
      create index if not exists idx_pancake_order_last_note_at
        on "pancake_order" (last_note_at);
    `)
    this.addSql(`
      create index if not exists idx_pancake_order_pancake_created_at
        on "pancake_order" (pancake_created_at);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists idx_pancake_order_last_note_at;`)
    this.addSql(`drop index if exists idx_pancake_order_pancake_created_at;`)
    this.addSql(`
      alter table "pancake_order"
        drop column if exists "notes",
        drop column if exists "last_note_at",
        drop column if exists "call_count",
        drop column if exists "tags";
    `)
  }
}
