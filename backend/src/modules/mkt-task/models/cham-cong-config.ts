import { model } from "@medusajs/framework/utils"

// Single-row config (id cố định "default") — giờ ca chuẩn dùng để tính đi muộn/về sớm.
const ChamCongConfig = model.define("cham_cong_config", {
  id: model.id().primaryKey(),
  shift_start: model.text().default("08:30"), // HH:mm
  shift_end: model.text().default("17:30"),
  work_days: model.json().default([1, 2, 3, 4, 5, 6] as any), // 0=CN..6=T7
  late_grace_min: model.number().default(5),
  // Danh sách ngày T7 cụ thể ("YYYY-MM-DD") chỉ làm buổi sáng — HR tự chọn đầu tháng,
  // không theo quy luật tuần chẵn/lẻ cố định. Không nằm trong work_days vì đó là rule
  // theo THỨ áp dụng mọi tuần, còn đây là NGÀY cụ thể ghi đè cho 1 lần.
  half_day_saturdays: model.json().default([] as any),
  // OT: số phút vượt shift_end tối thiểu mới tính là làm thêm (chống ghi nhận OT vài phút không đáng kể).
  ot_min_threshold_min: model.number().default(15),
  // Accrual phép năm: số ngày cộng mỗi tháng làm đủ + trần tối đa mỗi năm dương lịch.
  phep_nam_per_month: model.number().default(1),
  phep_nam_max_per_year: model.number().default(12),
})

export default ChamCongConfig
