import { model } from "@medusajs/framework/utils"

const WebPageview = model.define("web_pageview", {
  id: model.id().primaryKey(),
  visitor_id: model.text(),
  session_id: model.text(),
  url: model.text().default(""),
  title: model.text().default(""),
  referrer: model.text().default(""),
  utm_source: model.text().default(""),
  utm_campaign: model.text().default(""),
  time_on_prev_page: model.number().default(0),  // giây ở trang trước
})

export default WebPageview
