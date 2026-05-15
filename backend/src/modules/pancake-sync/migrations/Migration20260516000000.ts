import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260516000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "pancake_order"
        add column if not exists "care_name" text not null default '';
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table "pancake_order"
        drop column if exists "care_name";
    `)
  }
}