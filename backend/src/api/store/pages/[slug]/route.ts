import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// GET /store/pages/:slug - public endpoint for storefront
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { slug } = req.params

  const { data: pages } = await query.graph({
    entity: "page",
    fields: ["id", "title", "slug", "content", "status"],
    filters: { slug, status: "published" },
  })

  if (!pages.length) {
    return res.status(404).json({ message: "Không tìm thấy trang" })
  }

  res.json({ page: pages[0] })
}
