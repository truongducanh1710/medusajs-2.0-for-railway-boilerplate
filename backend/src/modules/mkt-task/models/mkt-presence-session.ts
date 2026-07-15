import { model } from "@medusajs/framework/utils"

// Mỗi tab mkt-chat mở = 1 session. Đóng tab/mất mạng → ended_at được set.
// active_seconds/idle_seconds cộng dồn từ heartbeat để tách "mở tab" vs "thật sự dùng".
const MktPresenceSession = model.define("mkt_presence_session", {
  id: model.id().primaryKey(),
  user_email: model.text(),
  status: model.text().default("online"), // online | idle | offline
  started_at: model.dateTime(),
  last_seen_at: model.dateTime(),
  last_active_at: model.dateTime(),
  ended_at: model.dateTime().nullable(),
  active_seconds: model.number().default(0),
  idle_seconds: model.number().default(0),
  day_key: model.text(), // "2026-07-15" theo giờ VN — gom báo cáo theo ngày
  user_agent: model.text().nullable(),
})

export default MktPresenceSession
