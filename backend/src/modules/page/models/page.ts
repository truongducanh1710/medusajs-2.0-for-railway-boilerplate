import { model } from "@medusajs/framework/utils"

const Page = model.define("page", {
  id: model.id().primaryKey(),
  title: model.text(),
  slug: model.text(),
  content: model.text().default("{}"),
  status: model.text().default("draft"), // draft | published
})

export default Page
