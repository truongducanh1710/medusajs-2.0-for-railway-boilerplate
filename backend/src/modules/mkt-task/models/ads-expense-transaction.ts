import { model } from "@medusajs/framework/utils"

const AdsExpenseTransaction = model.define("ads_expense_transaction", {
  id: model.id().primaryKey(),
  source_message_id: model.text().nullable(),
  channel_id: model.text(),
  card_last4: model.text().nullable(),
  merchant: model.text().nullable(),
  amount: model.number(),
  currency: model.text().default("VND"),
  txn_at: model.dateTime().nullable(),
  raw_text: model.text().nullable(),
  parsed_by: model.text().default("regex"),
})

export default AdsExpenseTransaction
