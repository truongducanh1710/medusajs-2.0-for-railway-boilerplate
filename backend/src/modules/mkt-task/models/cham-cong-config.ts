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
})

export default ChamCongConfig
