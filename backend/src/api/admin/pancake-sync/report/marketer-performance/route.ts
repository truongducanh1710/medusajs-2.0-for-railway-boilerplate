import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/pancake-sync/report/marketer-performance?from=...&to=...
 * Tình trạng vận đơn theo NV MKT (marketer_name)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.query as Record<string, string>
    if (!from || !to) return res.status(400).json({ error: "Thiếu from/to" })

    const pool = getPool()

    const { rows } = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(marketer_name), ''), 'Không rõ') as marketer,
        COUNT(*)::int                                                       as da_nhan,
        COUNT(*) FILTER (WHERE status = 5)::int                            as da_hoan,
        COUNT(*) FILTER (WHERE status = 4)::int                            as dang_hoan,
        COUNT(*) FILTER (WHERE status IN (6, -1))::int                     as da_huy,
        COUNT(*) FILTER (WHERE status = 7)::int                            as da_xoa,
        COUNT(*) FILTER (WHERE status IN (9, 2, 3))::int                   as da_gui_hang,
        COUNT(*) FILTER (WHERE status = 0)::int                            as moi,
        COUNT(*) FILTER (WHERE status = 11)::int                           as cho_hang,
        COUNT(*) FILTER (WHERE status = 1)::int                            as da_xac_nhan,
        COUNT(*) FILTER (WHERE status = 3)::int                            as tong_giao
      FROM pancake_order
      WHERE pancake_created_at BETWEEN $1 AND $2
        AND source IN ('manual', 'facebook', 'zalo', 'unknown', 'medusa')
      GROUP BY marketer_name
      ORDER BY da_nhan DESC
    `, [from, to])

    const enriched = rows.map((r) => {
      const da_nhan = r.da_nhan || 0
      const hoan_huy = r.da_hoan + r.dang_hoan + r.da_huy
      return {
        ...r,
        hoan_huy,
        ty_le_hoan:  da_nhan > 0 ? Math.round((r.da_hoan + r.dang_hoan) / da_nhan * 1000) / 10 : 0,
        ty_le_huy:   da_nhan > 0 ? Math.round(r.da_huy / da_nhan * 1000) / 10 : 0,
        ty_le_giao:  da_nhan > 0 ? Math.round(r.tong_giao / da_nhan * 1000) / 10 : 0,
      }
    })

    // TỔNG row
    const sum = (field: string) => enriched.reduce((acc, r) => acc + (r[field] || 0), 0)
    const total_da_nhan = sum("da_nhan")
    const total_hoan_huy = sum("hoan_huy")
    const summary = {
      marketer: "TỔNG",
      da_nhan:     total_da_nhan,
      da_hoan:     sum("da_hoan"),
      dang_hoan:   sum("dang_hoan"),
      da_huy:      sum("da_huy"),
      da_xoa:      sum("da_xoa"),
      da_gui_hang: sum("da_gui_hang"),
      moi:         sum("moi"),
      cho_hang:    sum("cho_hang"),
      da_xac_nhan: sum("da_xac_nhan"),
      tong_giao:   sum("tong_giao"),
      hoan_huy:    total_hoan_huy,
      ty_le_hoan:  total_da_nhan > 0 ? Math.round((sum("da_hoan") + sum("dang_hoan")) / total_da_nhan * 1000) / 10 : 0,
      ty_le_huy:   total_da_nhan > 0 ? Math.round(sum("da_huy") / total_da_nhan * 1000) / 10 : 0,
      ty_le_giao:  total_da_nhan > 0 ? Math.round(sum("tong_giao") / total_da_nhan * 1000) / 10 : 0,
    }

    return res.json({ rows: enriched, summary })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
