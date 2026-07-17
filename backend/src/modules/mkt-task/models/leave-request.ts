import { model } from "@medusajs/framework/utils"

const LeaveRequest = model.define("leave_request", {
  id: model.id().primaryKey(),
  requester_email: model.text(),
  leave_type: model.text(), // khong_luong | phep_nam | om | khac
  start_at: model.dateTime(),
  end_at: model.dateTime(),
  reason: model.text().nullable(),
  status: model.text().default("pending"), // pending | approved | rejected | cancelled
  reviewer_email: model.text().nullable(),
  reviewed_at: model.dateTime().nullable(),
  review_note: model.text().nullable(),
})

export default LeaveRequest
