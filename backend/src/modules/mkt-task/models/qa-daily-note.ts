import { model } from "@medusajs/framework/utils"

// Nhật ký QA theo ngày — leader ghi nhanh sự việc nổi bật của từng nhân sự mỗi ngày.
// Không phải điểm số; là bằng chứng để cuối tuần chấm qa_weekly_score cho khách quan.
const QaDailyNote = model.define("qa_daily_note", {
  id: model.id().primaryKey(),
  employee_email: model.text(),          // email user admin (nguồn nhân sự = tài khoản đăng nhập)
  dept: model.text(),                    // van_don | sale
  note_date: model.text(),               // "2026-07-20" (VN day key)
  label: model.text().default("info"),   // good | warn | error | info
  content: model.text(),
  is_fatal: model.boolean().default(false), // lỗi liệt phát hiện trong ngày (trạng thái ảo / sai COD)
  fatal_kind: model.text().nullable(),   // fake_status | wrong_cod — phân loại lỗi liệt
  created_by: model.text(),              // email leader ghi chú
})

export default QaDailyNote
