import { model } from "@medusajs/framework/utils"

const MktTask = model.define("mkt_task", {
  id: model.id().primaryKey(),
  title: model.text(),
  type: model.text(), // ads_camp | content_post
  assignee_id: model.text(),
  created_by: model.text(),
  deadline: model.dateTime().nullable(),
  status: model.text().default("todo"), // todo | in_progress | done | cancelled | missed
  priority: model.text().default("medium"), // high | medium | low
  tags: model.json(),
  notes: model.text().nullable(),
  comments: model.json(),
  rating: model.number().nullable(),
  channel_id: model.text().nullable(),
  // Recurring task support
  output: model.text().nullable(),          // Tiêu chí done định lượng ("Output cần có")
  result: model.text().nullable(),          // Kết quả thực tế nhân sự điền khi done
  frequency: model.text().default("once"),  // once | daily | weekly | monthly
  is_template: model.boolean().default(false), // true = task mẫu lặp
  template_id: model.text().nullable(),     // instance → trỏ về template sinh ra nó
  period_key: model.text().nullable(),      // "2026-06-12" | "2026-W24" | "2026-06" — chống sinh trùng
  checklist: model.json().nullable(),       // [{ id, text, done }] — assignee tự quản sub-steps
})

export default MktTask
