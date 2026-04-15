import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// GET /admin/pages/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { id } = req.params

  const { data: pages } = await query.graph({
    entity: "page",
    fields: ["id", "title", "slug", "content", "status", "created_at", "updated_at"],
    filters: { id },
  })

  if (!pages.length) {
    return res.status(404).json({ message: "Không tìm thấy trang" })
  }

  res.json({ page: pages[0] })
}

// PUT /admin/pages/:id - save GrapesJS content
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const { title, slug, content, status } = req.body as any

  const pageService = req.scope.resolve("pageModuleService") as any
  const page = await pageService.updatePages({ id, title, slug, content, status })

  res.json({ page })
}

// DELETE /admin/pages/:id
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const pageService = req.scope.resolve("pageModuleService") as any
  await pageService.deletePages(id)

  res.json({ deleted: true })
}
