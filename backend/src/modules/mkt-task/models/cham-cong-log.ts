import { model } from "@medusajs/framework/utils"

// Nhân viên bấm "Chấm công vào/ra" chủ động, kèm GPS lúc bấm — khác với
// mkt_presence_session (tự động track qua tab mkt-chat mở, không cần bấm).
const ChamCongLog = model.define("cham_cong_log", {
  id: model.id().primaryKey(),
  user_email: model.text(),
  action: model.text(), // in | out
  lat: model.number().nullable(),
  lng: model.number().nullable(),
  accuracy_m: model.number().nullable(),
  address: model.text().nullable(),
  day_key: model.text(), // "2026-07-17" theo giờ VN
})

export default ChamCongLog
