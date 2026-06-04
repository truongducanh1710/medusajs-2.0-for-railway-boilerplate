import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, getPageTokens, filterByPerm, ensureTables } from "./_lib"
import { isTokenError } from "../../../lib/fb-graph"

/**
 * GET /admin/fb-content        → list pages (đã lọc quyền)
 * GET /admin/fb-content?posts=1 → list scheduled/published posts
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const q = req.query as Record<string, string>
    const pool = getPool()
    await ensureTables(pool)

    if (q.posts === "1") {
      const params: any[] = []
      let where = "WHERE 1=1"
      if (q.status) { params.push(q.status); where += ` AND p.status = $${params.length}` }
      if (q.from) { params.push(q.from); where += ` AND COALESCE(p.scheduled_for, p.created_at) >= $${params.length}` }
      if (q.to)   { params.push(q.to);   where += ` AND COALESCE(p.scheduled_for, p.created_at) <= $${params.length}` }
      // only_posted: chỉ video đã đăng FB thành công (có post_id) — cho tính năng Tạo Camp
      if (q.only_posted === "1") where += ` AND p.post_id IS NOT NULL AND p.media_type = 'video'`
      // maker: lọc theo MKT (tên người làm video)
      if (q.maker) { params.push(q.maker); where += ` AND v.maker = $${params.length}` }
      // JOIN mkt_video để lấy vd_code + product + maker (cho tính năng Lên Camp)
      const { rows } = await pool.query(
        `SELECT p.*, v.vd_code, v.product, v.maker
           FROM fb_scheduled_post p
           LEFT JOIN mkt_video v ON v.id = p.video_id
         ${where} ORDER BY COALESCE(p.scheduled_for, p.created_at) DESC LIMIT 200`,
        params
      )
      return res.json({ posts: rows })
    }

    // list pages
    let pages: any[]
    try {
      pages = await getPageTokens(pool, q.force_refresh === "true")
    } catch (e: any) {
      if (isTokenError(e)) return res.status(200).json({ pages: [], error: "FB_TOKEN_EXPIRED" })
      throw e
    }
    // all=true: admin lấy tất cả pages để phân quyền (không lọc quyền)
    const filtered = (q.all === "true" && auth.isAdmin) ? pages : filterByPerm(pages, auth)
    const visible = filtered.map(p => ({
      page_id: p.page_id, page_name: p.page_name, category: p.category, fan_count: p.fan_count,
    }))
    return res.json({ pages: visible })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
