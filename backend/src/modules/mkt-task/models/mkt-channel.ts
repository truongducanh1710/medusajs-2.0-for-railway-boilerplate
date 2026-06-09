import { model } from "@medusajs/framework/utils"

const MktChannel = model.define("mkt_channel", {
  id: model.id().primaryKey(),
  name: model.text(),
  description: model.text().nullable(),
  created_by: model.text(),
  members: model.json(),
})

export default MktChannel
