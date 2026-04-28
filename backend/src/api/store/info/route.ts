import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve("query")
  const { data: [store] } = await query.graph({
    entity: "store",
    fields: ["id", "name", "metadata"],
  })
  res.json({ store: store ?? {} })
}
