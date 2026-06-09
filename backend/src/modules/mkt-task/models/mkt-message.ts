import { model } from "@medusajs/framework/utils"

const MktMessage = model.define("mkt_message", {
  id: model.id().primaryKey(),
  channel_id: model.text(),
  author_id: model.text(),
  content: model.text(),
  task_id: model.text().nullable(),
  // text | task_created | task_updated | task_done | deadline_reminder | ai_response
  msg_type: model.text().default("text"),
  metadata: model.json().nullable(),
})

export default MktMessage
