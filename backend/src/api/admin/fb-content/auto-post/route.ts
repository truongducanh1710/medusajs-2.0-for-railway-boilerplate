import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo } from "../_lib"
import { ensureAutoPostTables, previewAutoPost } from "../../../../lib/fb-auto-post"

/**
 * GET /admin/fb-content/auto-post            → rules + last 14 days of auto-post log
 * GET /admin/fb-content/auto-post?preview=1  → also what each enabled rule would post now (no writes)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await ensureAutoPostTables(pool)
    const { rows: rules } = await pool.query(`SELECT * FROM fb_auto_post_rule ORDER BY post_time, page_name`)
    const { rows: log } = await pool.query(
      `SELECT * FROM fb_auto_post_log WHERE day > (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 14 ORDER BY day DESC, page_name`
    )
    const preview = (req.query as any)?.preview ? await previewAutoPost(pool) : undefined
    return res.json({ rules, log, preview })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}

/**
 * POST /admin/fb-content/auto-post — upsert one rule.
 * body: { page_id, page_name?, product_codes: string[], post_time?: "HH:MM", enabled?: boolean }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const b: any = req.body || {}
    const pageId = String(b.page_id || "").trim()
    const codes: string[] = Array.isArray(b.product_codes) ? b.product_codes.map(String).filter(Boolean) : []
    const postTime = b.post_time ? String(b.post_time) : "11:00"
    if (!pageId) return res.status(400).json({ error: "Thiếu page_id" })
    if (!codes.length) return res.status(400).json({ error: "Chưa chọn sản phẩm" })
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(postTime)) return res.status(400).json({ error: "Giờ đăng phải dạng HH:MM" })

    const pool = getPool()
    await ensureAutoPostTables(pool)
    const { rows: [pg] } = await pool.query(`SELECT page_name FROM fb_page_token WHERE page_id = $1`, [pageId])
    if (!pg) return res.status(400).json({ error: "Page không có trong hệ thống" })

    const { rows: [rule] } = await pool.query(
      `INSERT INTO fb_auto_post_rule (page_id, page_name, product_codes, post_time, enabled, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (page_id) DO UPDATE SET page_name=EXCLUDED.page_name, product_codes=EXCLUDED.product_codes,
         post_time=EXCLUDED.post_time, enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=now()
       RETURNING *`,
      [pageId, pg.page_name, codes, postTime, b.enabled !== false, auth.email]
    )
    return res.json({ rule })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
