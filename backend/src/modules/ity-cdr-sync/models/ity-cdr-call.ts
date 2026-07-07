import { model } from "@medusajs/framework/utils"

// CDR (Call Detail Record) từ tổng đài ITY — API bên ITY chỉ giữ 30 ngày,
// nên phải sync hằng ngày để lưu vĩnh viễn, phục vụ theo dõi hiệu suất Sale/CSKH.
const ItyCdrCall = model.define("ity_cdr_call", {
  id: model.text().primaryKey(),               // uniqueid từ ITY
  calldate: model.dateTime(),                   // thời điểm gọi
  direction: model.text().default(""),          // outgoing | incoming
  extension: model.text().default(""),          // src/cnum — máy nhánh (chưa map sang tên NV)
  agent_name: model.text().default(""),         // cnam/clid — tên hiển thị trên tổng đài (có thể trùng nhiều người)
  customer_phone: model.text().default(""),     // dst
  duration: model.number().default(0),          // tổng thời gian (kể cả đổ chuông)
  billsec: model.number().default(0),           // thời gian đàm thoại thực tế
  disposition: model.text().default(""),        // ANSWERED | NO ANSWER | ...
  recording_url: model.text().nullable(),
  raw: model.json().default({}),
  synced_at: model.dateTime(),
})

export default ItyCdrCall
