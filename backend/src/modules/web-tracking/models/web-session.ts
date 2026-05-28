import { model } from "@medusajs/framework/utils"

const WebSession = model.define("web_session", {
  id: model.text().primaryKey(),          // visitor_id + session_id composite key stored as "vid_sid"
  visitor_id: model.text(),               // uuid lưu trong cookie pvw_vid (1 năm)
  session_id: model.text(),               // uuid lưu trong cookie pvw_sid (30 phút sliding)
  first_seen: model.dateTime(),
  last_seen: model.dateTime(),
  current_url: model.text().default(""),
  referrer: model.text().default(""),
  utm_source: model.text().default(""),
  utm_medium: model.text().default(""),
  utm_campaign: model.text().default(""),
  utm_content: model.text().default(""),
  utm_term: model.text().default(""),
  device_type: model.text().default(""),  // "mobile" | "tablet" | "desktop"
  user_agent: model.text().default(""),
  ip: model.text().default(""),
  province: model.text().default(""),     // từ IP lookup (để null nếu chưa map)
  has_cart: model.boolean().default(false),
  cart_id: model.text().nullable(),
  pageview_count: model.number().default(0),
})

export default WebSession
