import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// GET /admin/pages - list all pages
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pageService = req.scope.resolve("pageModule") as any
    const pages = await pageService.listPages(
      {},
      { select: ["id", "title", "slug", "status", "created_at", "updated_at"] }
    )
    res.json({ pages })
  } catch (e: any) {
    res.status(500).json({ message: e.message })
  }
}

// POST /admin/pages - create new page
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { title, slug, content, status } = req.body as any
    const pageService = req.scope.resolve("pageModule") as any

    const existing = await pageService.listPages({ slug })
    if (existing.length > 0) {
      return res.status(400).json({ message: "Slug đã tồn tại" })
    }

    const page = await pageService.createPages({
      title,
      slug,
      content: content || "{}",
      status: status || "draft",
    })

    res.json({ page })
  } catch (e: any) {
    res.status(500).json({ message: e.message })
  }
}
