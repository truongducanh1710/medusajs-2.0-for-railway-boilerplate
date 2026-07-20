import { model } from "@medusajs/framework/utils"

// Điểm QA theo tuần — leader chấm 6 tiêu chí (0..max) cho từng nhân sự mỗi tuần.
// Tên + điểm tối đa của 6 tiêu chí khác nhau giữa Vận Đơn và Sale; xem QA_CRITERIA ở service.
// total = tổng c1..c6, nhưng nếu fatal_flag=true thì điểm tuần = 0 (lỗi liệt theo BGĐ).
const QaWeeklyScore = model.define("qa_weekly_score", {
  id: model.id().primaryKey(),
  employee_email: model.text(),
  dept: model.text(),                    // van_don | sale
  week_key: model.text(),                // "2026-W29" (ISO week) — 1 người/1 tuần/1 dòng
  month_key: model.text(),               // "2026-07" — để AVERAGEIF ra điểm tháng
  c1: model.number().default(0),
  c2: model.number().default(0),
  c3: model.number().default(0),
  c4: model.number().default(0),
  c5: model.number().default(0),
  c6: model.number().default(0),
  fatal_flag: model.boolean().default(false), // bật → total ép về 0 (không sửa tay)
  total: model.number().default(0),      // điểm cuối cùng đã áp lỗi liệt (tính ở service khi lưu)
  comment: model.text().nullable(),      // lý do trừ điểm nặng
  scored_by: model.text(),               // email leader chấm
})

export default QaWeeklyScore
