import { model } from "@medusajs/framework/utils"

const PancakeCronLog = model.define("pancake_cron_log", {
  id: model.id().primaryKey(),
  run_type: model.text().default("active"),       // 'active' | 'nightly'
  started_at: model.dateTime(),
  finished_at: model.dateTime().nullable(),
  duration_ms: model.number().nullable(),
  statuses: model.json().default([] as any),       // [{ status, total, updated, created, errors }]
  total_orders: model.number().default(0),
  total_updated: model.number().default(0),
  total_created: model.number().default(0),
  total_errors: model.number().default(0),
  error_details: model.json().default([] as any),  // [{ status, order_id, message }]
  success: model.boolean().default(true),
})

export default PancakeCronLog
