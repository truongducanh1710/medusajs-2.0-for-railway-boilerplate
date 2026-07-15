import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260716000000 extends Migration {
  async up(): Promise<void> {
    // Chống trùng khi paste lại / gửi nhầm cùng 1 giao dịch nhiều lần:
    // cùng channel + thẻ + số tiền + thời điểm giao dịch chỉ được lưu 1 lần.
    this.addSql(`
      create unique index if not exists "ads_expense_transaction_dedup_idx"
      on "ads_expense_transaction" ("channel_id", "card_last4", "amount", "txn_at")
      where deleted_at is null and txn_at is not null;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "ads_expense_transaction_dedup_idx";`)
  }
}
