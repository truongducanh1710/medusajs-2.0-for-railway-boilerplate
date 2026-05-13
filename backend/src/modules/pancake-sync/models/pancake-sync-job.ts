import { model } from "@medusajs/framework/utils"

const PancakeSyncJob = model.define("pancake_sync_job", {
  id: model.id().primaryKey(),
  status: model.text().default("queued"),       // queued | running | done | failed
  from_date: model.dateTime(),
  to_date: model.dateTime(),
  started_at: model.dateTime().nullable(),
  finished_at: model.dateTime().nullable(),
  stats: model.json().default({}),              // { imported, updated, failed_pages, errors[], duration_ms }
  error: model.text().nullable(),
})

export default PancakeSyncJob
