import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// GET /admin/pages - list all pages
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: pages } = await query.graph({
    entity: "page",
    fields: ["id", "title", "slug", "status", "created_at", "updated_at"],
  })

  res.json({ pages })
}

// POST /admin/pages - create new page
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { title, slug, content, status } = req.body as any

  const { data: pages } = await query.graph({
    entity: "page",
    fields: ["id"],
    filters: { slug },
  })

  if (pages.length > 0) {
    return res.status(400).json({ message: "Slug đã tồn tại" })
  }

  const pageService = req.scope.resolve("pageModuleService") as any
  const page = await pageService.createPages({
    title,
    slug,
    content: content || "{}",
    status: status || "draft",
  })

  res.json({ page })
}
