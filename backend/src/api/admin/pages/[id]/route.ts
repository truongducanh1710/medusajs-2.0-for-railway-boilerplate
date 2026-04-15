import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// GET /admin/pages/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const pageService = req.scope.resolve("pageModuleService") as any
    const pages = await pageService.listPages({ id })

    if (!pages.length) {
      return res.status(404).json({ message: "Không tìm thấy trang" })
    }

    res.json({ page: pages[0] })
  } catch (e: any) {
    res.status(500).json({ message: e.message })
  }
}

// PUT /admin/pages/:id - save GrapesJS content
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const { title, slug, content, status } = req.body as any
    const pageService = req.scope.resolve("pageModuleService") as any

    const page = await pageService.updatePages({ id, title, slug, content, status })
    res.json({ page })
  } catch (e: any) {
    res.status(500).json({ message: e.message })
  }
}

// DELETE /admin/pages/:id
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const pageService = req.scope.resolve("pageModuleService") as any
    await pageService.deletePages(id)
    res.json({ deleted: true })
  } catch (e: any) {
    res.status(500).json({ message: e.message })
  }
}
