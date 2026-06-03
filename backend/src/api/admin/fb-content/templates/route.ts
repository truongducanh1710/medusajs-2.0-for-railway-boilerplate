import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo } from "../_lib"

/** GET /admin/fb-content/templates?search=&tag= */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const q = req.query as Record<string, string>
    const params: any[] = []
    let where = "WHERE deleted_at IS NULL"
    if (q.search) { params.push(`%${q.search}%`); where += ` AND (title ILIKE $${params.length} OR message ILIKE $${params.length})` }
    if (q.tag && q.tag !== "all") { params.push(q.tag); where += ` AND $${params.length} = ANY(tags)` }
    const pool = getPool()
    const { rows } = await pool.query(`SELECT * FROM fb_content_template ${where} ORDER BY usage_count DESC, created_at DESC`, params)
    return res.json({ templates: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/** POST /admin/fb-content/templates — tạo mẫu mới. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const b: Record<string, any> = (req.body && typeof req.body === "object") ? (req.body as any) : {}
    if (!b.title?.trim()) return res.status(400).json({ error: "Thiếu tên mẫu" })
    const tags: string[] = Array.isArray(b.tags) ? b.tags : String(b.tags || "").split(",").map((s: string) => s.trim()).filter(Boolean)
    const pool = getPool()
    const { rows: [t] } = await pool.query(
      `INSERT INTO fb_content_template (title, message, tags, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [b.title, b.message ?? "", tags, auth.email]
    )
    return res.json({ template: t })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
