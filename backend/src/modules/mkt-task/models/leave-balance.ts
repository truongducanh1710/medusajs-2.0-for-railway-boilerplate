import { model } from "@medusajs/framework/utils"

// Số phép năm còn lại của mỗi nhân viên, theo từng năm dương lịch. accrued_days cộng dần
// mỗi tháng làm việc đủ (xem job leave-balance-accrual); used_days trừ khi đơn nghỉ loại
// "phep_nam" được duyệt. Còn lại = accrued_days - used_days (tính tại API, không lưu cột riêng
// để tránh lệch khi sửa dữ liệu tay).
const LeaveBalance = model.define("leave_balance", {
  id: model.id().primaryKey(),
  user_email: model.text(),
  year: model.number(), // 2026
  accrued_days: model.number().default(0),
  used_days: model.number().default(0),
  last_accrual_month: model.text().nullable(), // "2026-07" — tháng gần nhất đã cộng, chống cộng trùng
})

export default LeaveBalance
