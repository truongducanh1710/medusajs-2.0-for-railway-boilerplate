import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, STATUS_KEY_TO_VI } from "../_lib"

/**
 * GET /admin/marketing-video/report?from=&to=
 * Báo cáo nguyên liệu video: tổng, theo người, theo loại, theo SP, theo trạng thái.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const q = req.query as Record<string, string>
    const params: any[] = []
    let where = "WHERE 1=1"
    // Lọc theo ngày — dùng COALESCE(post_date, created_at) để dòng chưa có ngày đăng
    // vẫn tính theo ngày tạo (tránh báo cáo rỗng khi post_date NULL)
    if (q.from) { params.push(q.from); where += ` AND COALESCE(post_date, created_at::date) >= $${params.length}` }
    if (q.to)   { params.push(q.to);   where += ` AND COALESCE(post_date, created_at::date) <= $${params.length}` }

    const pool = getPool()

    const [byPerson, byType, byProduct, byStatus, totalRow] = await Promise.all([
      pool.query(`SELECT maker AS label, COUNT(*)::int AS value FROM mkt_video ${where} GROUP BY maker ORDER BY value DESC`, params),
      pool.query(`SELECT video_type AS label, COUNT(*)::int AS value FROM mkt_video ${where} GROUP BY video_type ORDER BY value DESC`, params),
      pool.query(`SELECT product AS label, COUNT(*)::int AS value FROM mkt_video ${where} GROUP BY product ORDER BY value DESC LIMIT 8`, params),
      pool.query(`SELECT status AS key, COUNT(*)::int AS value FROM mkt_video ${where} GROUP BY status`, params),
      pool.query(`SELECT COUNT(*)::int AS total FROM mkt_video ${where}`, params),
    ])

    const statusMap: Record<string, number> = {}
    for (const r of byStatus.rows) statusMap[STATUS_KEY_TO_VI[r.key] || r.key] = r.value

    return res.json({
      total: totalRow.rows[0].total,
      byPerson: byPerson.rows,
      byType: byType.rows.filter((r: any) => r.label),
      byProduct: byProduct.rows.filter((r: any) => r.label),
      byStatus: statusMap,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
