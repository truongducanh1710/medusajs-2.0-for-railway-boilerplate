import { model } from "@medusajs/framework/utils"

// Employee-registered overtime; managers review the requested duration.
// Legacy automatic requests are retained only as reviewed history.
const OvertimeRequest = model.define("overtime_request", {
  id: model.id().primaryKey(),
  user_email: model.text(),
  day_key: model.text(), // "2026-07-17" giờ VN — ngày phát sinh OT
  duration_min: model.number(), // requested minutes (employee or HR)
  approved_duration_min: model.number().nullable(), // số phút sau khi manager sửa (nếu có)
  source: model.text().default("employee"), // employee | manual | auto (legacy)
  note: model.text().nullable(),
  status: model.text().default("pending"), // pending | approved | rejected
  reviewer_email: model.text().nullable(),
  reviewed_at: model.dateTime().nullable(),
})

export default OvertimeRequest
