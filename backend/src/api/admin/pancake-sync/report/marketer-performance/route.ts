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

    // "Đã nhận" = đơn giao thành công (status 3), khớp tab "Đã nhận" trên POS.
    // Nguồn: chỉ loại TikTok/Shopee (sàn TMĐT có flow CSKH riêng), giữ phần còn lại
    // (manual/facebook/zalo/medusa/unknown...) để khớp filter "TikTok ✕ Shopee ✕"
    // trên POS. Lưu ý: "Webcake" của Pancake đã được detectSource map về manual/medusa,
    // không tồn tại dưới dạng source 'webcake' trong DB.
    // from/to đã là biên UTC chuẩn theo giờ VN do frontend (toISO) tính sẵn.
    const { rows } = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(marketer_name), ''), 'Không rõ') as marketer,
        COUNT(*) FILTER (WHERE status = 3)::int                            as da_nhan,
        COUNT(*) FILTER (WHERE status = 5)::int                            as da_hoan,
        COUNT(*) FILTER (WHERE status = 4)::int                            as dang_hoan,
        COUNT(*) FILTER (WHERE status IN (6, -1))::int                     as da_huy,
        COUNT(*) FILTER (WHERE status = 7)::int                            as da_xoa,
        COUNT(*) FILTER (WHERE status IN (9, 2))::int                      as da_gui_hang,
        COUNT(*) FILTER (WHERE status = 0)::int                            as moi,
        COUNT(*) FILTER (WHERE status = 11)::int                           as cho_hang,
        COUNT(*) FILTER (WHERE status = 1)::int                            as da_xac_nhan,
        COUNT(*) FILTER (WHERE status = 3)::int                            as tong_giao,
        COUNT(*)::int                                                       as tong_don
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND pancake_created_at BETWEEN $1 AND $2
        AND source NOT IN ('tiktok', 'shopee')
      GROUP BY marketer_name
      ORDER BY da_nhan DESC
    `, [from, to])

    // Tỷ lệ hoàn/hủy/giao tính trên TỔNG đơn hợp lệ (trừ đã xóa), không phải trên
    // số đã giao — vì đơn hoàn/hủy không nằm trong status 3.
    const enriched = rows.map((r) => {
      const base = (r.tong_don || 0) - (r.da_xoa || 0)
      const hoan_huy = r.da_hoan + r.dang_hoan + r.da_huy
      return {
        ...r,
        hoan_huy,
        ty_le_hoan:  base > 0 ? Math.round((r.da_hoan + r.dang_hoan) / base * 1000) / 10 : 0,
        ty_le_huy:   base > 0 ? Math.round(r.da_huy / base * 1000) / 10 : 0,
        ty_le_giao:  base > 0 ? Math.round(r.tong_giao / base * 1000) / 10 : 0,
      }
    })

    // TỔNG row
    const sum = (field: string) => enriched.reduce((acc, r) => acc + (r[field] || 0), 0)
    const total_da_nhan = sum("da_nhan")
    const total_hoan_huy = sum("hoan_huy")
    const total_base = sum("tong_don") - sum("da_xoa")
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
      ty_le_hoan:  total_base > 0 ? Math.round((sum("da_hoan") + sum("dang_hoan")) / total_base * 1000) / 10 : 0,
      ty_le_huy:   total_base > 0 ? Math.round(sum("da_huy") / total_base * 1000) / 10 : 0,
      ty_le_giao:  total_base > 0 ? Math.round(sum("tong_giao") / total_base * 1000) / 10 : 0,
    }

    return res.json({ rows: enriched, summary })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
