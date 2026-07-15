import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260715220000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "ads_expense_transaction" (
        "id" text not null,
        "source_message_id" text null,
        "channel_id" text not null,
        "card_last4" text null,
        "merchant" text null,
        "amount" numeric not null,
        "currency" text not null default 'VND',
        "txn_at" timestamptz null,
        "raw_text" text null,
        "parsed_by" text not null default 'regex',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "ads_expense_transaction_pkey" primary key ("id")
      );
    `)

    this.addSql(`create index "ads_expense_transaction_channel_idx" on "ads_expense_transaction" ("channel_id") where deleted_at is null;`)
    this.addSql(`create index "ads_expense_transaction_txn_at_idx" on "ads_expense_transaction" ("txn_at") where deleted_at is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "ads_expense_transaction" cascade;`)
  }
}
