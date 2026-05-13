import { model } from "@medusajs/framework/utils"

const PancakeOrder = model.define("pancake_order", {
  id: model.text().primaryKey(),               // Pancake order ID (string-safe)
  medusa_order_id: model.text().nullable(),    // Link nếu đơn từ Medusa
  source: model.text().default("unknown"),     // 'medusa' | 'facebook' | 'zalo' | 'tiktok' | 'manual' | ...
  status: model.number().default(0),
  status_name: model.text().default(""),
  status_history: model.json().default([] as any),    // [{status, status_name, changed_at, source: 'webhook'|'sync'}]
  customer_name: model.text().default(""),
  customer_phone: model.text().default(""),
  province: model.text().default(""),
  total: model.number().default(0),
  shipping_fee: model.number().default(0),
  cod_amount: model.number().default(0),
  items: model.json().default([] as any),             // [{name, qty, price}]
  items_count: model.number().default(0),
  tracking_code: model.text().default(""),
  currency: model.text().default("VND"),
  raw: model.json().default({}),               // full Pancake response — exclude khỏi list query
  raw_version: model.text().default("v1"),
  data_quality: model.text().default("complete"), // 'complete' | 'partial' (đơn cũ thiếu field)
  pancake_created_at: model.dateTime().nullable(),
  synced_at: model.dateTime(),
})

export default PancakeOrder
