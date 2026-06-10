import { model } from "@medusajs/framework/utils"

const MktTask = model.define("mkt_task", {
  id: model.id().primaryKey(),
  title: model.text(),
  type: model.text(), // ads_camp | content_post
  assignee_id: model.text(),
  created_by: model.text(),
  deadline: model.dateTime().nullable(),
  status: model.text().default("todo"), // todo | in_progress | done | cancelled
  priority: model.text().default("medium"), // high | medium | low
  tags: model.json(),
  notes: model.text().nullable(),
  comments: model.json(),
  rating: model.number().nullable(),
  channel_id: model.text().nullable(),
})

export default MktTask
