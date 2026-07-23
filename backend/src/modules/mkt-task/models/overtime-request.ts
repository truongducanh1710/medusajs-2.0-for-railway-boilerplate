import { model } from "@medusajs/framework/utils"

// Giờ làm thêm (OT) sau giờ ra ca chuẩn. duration_min tự tính từ checkout GPS
// (cham_cong_log) khi vượt ngưỡng ot_min_threshold_min trong config; manager có thể
// sửa lại số phút khi duyệt (VD nhân viên quên bấm checkout).
const OvertimeRequest = model.define("overtime_request", {
  id: model.id().primaryKey(),
  user_email: model.text(),
  day_key: model.text(), // "2026-07-17" giờ VN — ngày phát sinh OT
  duration_min: model.number(), // số phút OT (đề xuất, tự tính hoặc HR nhập tay)
  approved_duration_min: model.number().nullable(), // số phút sau khi manager sửa (nếu có)
  source: model.text().default("auto"), // auto | manual
  note: model.text().nullable(),
  status: model.text().default("pending"), // pending | approved | rejected
  reviewer_email: model.text().nullable(),
  reviewed_at: model.dateTime().nullable(),
})

export default OvertimeRequest
