import { model } from "@medusajs/framework/utils"

const MktMessage = model.define("mkt_message", {
  id: model.id().primaryKey(),
  channel_id: model.text(),
  author_id: model.text(),
  content: model.text(),
  task_id: model.text().nullable(),
  msg_type: model.text().default("text"),
  metadata: model.json().nullable(),
  reply_to_id: model.text().nullable(),
  reply_parent_id: model.text().nullable(),
  reply_count: model.number().default(0),
  file_url: model.text().nullable(),
  file_type: model.text().nullable(),
  file_name: model.text().nullable(),
  file_expires_at: model.dateTime().nullable(),
  reactions: model.json().default({}),
  is_pinned: model.boolean().default(false),
  mentions: model.json().default([] as any),
  recalled_at: model.dateTime().nullable(),
  edited_at: model.dateTime().nullable(), // set khi PATCH sửa content — client hiện nhãn "(đã sửa)"
  device: model.text().nullable(), // "mobile" | "desktop" — suy ra tu User-Agent luc gui tin
})

export default MktMessage