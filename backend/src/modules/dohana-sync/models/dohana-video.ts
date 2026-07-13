import { model } from "@medusajs/framework/utils"

const DohanaVideo = model.define("dohana_video", {
  id: model.text().primaryKey(),                 // Dohana video UUID
  store_id: model.text().default(""),
  order_code: model.text().default(""),
  prepare_code: model.text().default(""),
  type: model.text().default(""),                // package | inbound | outbound | prepare
  status: model.text().default(""),               // ACTIVE | INACTIVE | CONVERTED | CONVERTING | DELETED | UP_FAILED
  slug: model.text().default(""),
  duration: model.number().default(0),
  start_time: model.dateTime().nullable(),
  user_email: model.text().default(""),
  user_name: model.text().default(""),
  drive_link: model.text().nullable(),
  deleted_timeline: model.dateTime().nullable(),  // ngày Dohana tự xoá video
  raw: model.json().default({}),                   // full response gốc từ Dohana
  synced_at: model.dateTime(),
})

export default DohanaVideo
