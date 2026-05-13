import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260514000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "pancake_order"
        add column if not exists "marketer_name" text not null default '',
        add column if not exists "sale_name"     text not null default '';
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table "pancake_order"
        drop column if exists "marketer_name",
        drop column if exists "sale_name";
    `)
  }
}
