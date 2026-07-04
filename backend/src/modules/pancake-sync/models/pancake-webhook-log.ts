import { model } from "@medusajs/framework/utils"

const PancakeWebhookLog = model.define("pancake_webhook_log", {
  id: model.id().primaryKey(),
  received_at: model.dateTime(),
  pancake_order_id: model.text().default(""),
  pancake_status: model.number().nullable(),
  status_name: model.text().default(""),
  event_type: model.text().default("order"),       // 'order' | 'warehouse' | 'product' | 'unknown'
  api_fetch_success: model.boolean().nullable(),   // null = not attempted (non-order event)
  upsert_success: model.boolean().nullable(),
  fallback_used: model.boolean().default(false),   // true nếu API fetch fail, dùng minimal upsert
  error_message: model.text().nullable(),
  duration_ms: model.number().nullable(),
  market: model.text().default("VN"),              // 'VN' | 'MY' — shop Pancake webhook này thuộc về
})

export default PancakeWebhookLog
