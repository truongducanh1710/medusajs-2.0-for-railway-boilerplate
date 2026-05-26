import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/pancake-sync/report/shipping?from=...&to=...
 * Vận đơn & Hoàn hủy analytics
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.query as Record<string, string>
    if (!from || !to) return res.status(400).json({ error: "Thiếu from/to" })

    const pool = getPool()

    // Tổng hợp theo status
    const { rows: byStatus } = await pool.query(`
      SELECT
        status,
        COUNT(*) as count,
        COALESCE(SUM(cod_amount), 0) as cod_total
      FROM pancake_order
      WHERE pancake_created_at BETWEEN $1 AND $2
        AND source IN ('manual','facebook','zalo','unknown','medusa')
      GROUP BY status
      ORDER BY status
    `, [from, to])

    // Theo ngày: stacked giao thành công / hoàn / hủy
    const { rows: byDay } = await pool.query(`
      SELECT
        DATE(pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') as date,
        COUNT(*) FILTER (WHERE status = 3) as delivered,
        COUNT(*) FILTER (WHERE status IN (4,5,-2)) as returning,
        COUNT(*) FILTER (WHERE status IN (6,7,-1)) as cancelled,
        COUNT(*) as total
      FROM pancake_order
      WHERE pancake_created_at BETWEEN $1 AND $2
        AND source IN ('manual','facebook','zalo','unknown','medusa')
      GROUP BY date
      ORDER BY date
    `, [from, to])

    // Top tỉnh/thành có tỷ lệ hoàn cao
    const { rows: byProvince } = await pool.query(`
      SELECT
        COALESCE(NULLIF(province,''), 'Không rõ') as province,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN (4,5,-2)) as returned,
        ROUND(COUNT(*) FILTER (WHERE status IN (4,5,-2)) * 100.0 / NULLIF(COUNT(*),0), 1) as return_rate
      FROM pancake_order
      WHERE pancake_created_at BETWEEN $1 AND $2
        AND source IN ('manual','facebook','zalo','unknown','medusa')
      GROUP BY province
      HAVING COUNT(*) >= 5
      ORDER BY return_rate DESC
      LIMIT 15
    `, [from, to])

    // Top lý do hoàn từ tags (Hoan_*)
    const { rows: returnTags } = await pool.query(`
      SELECT
        tag->>'name' as tag_name,
        COUNT(*) as count
      FROM pancake_order,
        jsonb_array_elements(
          CASE WHEN jsonb_typeof(tags::jsonb) = 'array' THEN tags::jsonb ELSE '[]'::jsonb END
        ) AS tag
      WHERE pancake_created_at BETWEEN $1 AND $2
        AND status IN (4,5,-2)
        AND source IN ('manual','facebook','zalo','unknown','medusa')
        AND tag->>'name' ILIKE 'Hoan_%'
      GROUP BY tag_name
      ORDER BY count DESC
      LIMIT 10
    `, [from, to])

    // Summary
    const delivered   = byStatus.find(r => r.status === 3)
    const returning   = byStatus.filter(r => [4,5,-2].includes(Number(r.status)))
    const cancelled   = byStatus.filter(r => [6,7,-1].includes(Number(r.status)))
    const totalAll    = byStatus.reduce((s, r) => s + Number(r.count), 0)
    const returnCount = returning.reduce((s, r) => s + Number(r.count), 0)
    const cancelCount = cancelled.reduce((s, r) => s + Number(r.count), 0)
    const deliveredCount = Number(delivered?.count ?? 0)
    const deliveredCod   = Number(delivered?.cod_total ?? 0)
    const returningNow   = byStatus.find(r => r.status === 4)

    return res.json({
      summary: {
        total: totalAll,
        delivered: deliveredCount,
        delivered_cod: deliveredCod,
        returning_now: Number(returningNow?.count ?? 0),
        returning_now_cod: Number(returningNow?.cod_total ?? 0),
        returned: returnCount,
        cancelled: cancelCount,
        return_rate: totalAll > 0 ? Math.round(returnCount / totalAll * 100) : 0,
        cancel_rate: totalAll > 0 ? Math.round(cancelCount / totalAll * 100) : 0,
      },
      by_status: byStatus,
      by_day: byDay,
      by_province: byProvince,
      return_tags: returnTags,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
