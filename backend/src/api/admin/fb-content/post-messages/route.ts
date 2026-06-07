import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, ensureTables } from "../_lib"

/**
 * GET /admin/fb-content/post-messages
 * Lấy các message (caption) đã đăng theo sản phẩm — dùng làm content mẫu.
 *
 * Query params:
 *   product  — tên SP (ILIKE match), VD: "chảo vàng"
 *   limit    — mặc định 10, tối đa 50
 *   distinct — "1" để chỉ lấy message unique (bỏ trùng lặp)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const pool = getPool()
    await ensureTables(pool)

    const q = req.query as Record<string, string>
    const limit = Math.min(parseInt(q.limit || "10"), 50)
    const distinct = q.distinct === "1"

    const params: any[] = []
    let where = "WHERE message IS NOT NULL AND message != '' AND status IN ('published','scheduled')"

    if (q.product) {
      params.push(`%${q.product}%`)
      where += ` AND product ILIKE $${params.length}`
    }

    // Nếu distinct: group by message để loại trùng, lấy bài mới nhất mỗi nhóm
    let sql: string
    if (distinct) {
      sql = `
        SELECT DISTINCT ON (message)
          id, page_name, message, product, vd_code, maker, status,
          scheduled_for, published_at, created_at
        FROM fb_scheduled_post
        ${where}
        ORDER BY message, created_at DESC
        LIMIT $${params.length + 1}
      `
    } else {
      sql = `
        SELECT id, page_name, message, product, vd_code, maker, status,
               scheduled_for, published_at, created_at
        FROM fb_scheduled_post
        ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1}
      `
    }

    params.push(limit)
    const { rows } = await pool.query(sql, params)

    // Đếm tổng
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(DISTINCT message) AS total FROM fb_scheduled_post ${where}`,
      params.slice(0, -1)
    )

    return res.json({
      total: parseInt(countRows[0]?.total || "0"),
      messages: rows.map(r => ({
        id: r.id,
        page_name: r.page_name,
        product: r.product,
        vd_code: r.vd_code,
        maker: r.maker,
        status: r.status,
        message: r.message,
        char_count: (r.message || "").length,
        scheduled_for: r.scheduled_for,
        published_at: r.published_at,
      })),
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
