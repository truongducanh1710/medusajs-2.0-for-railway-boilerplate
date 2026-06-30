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

    // Đếm theo status code (mapping verify qua orders/facets):
    //   0=Mới, 1=Đã xác nhận, 2=Đã gửi hàng, 3=Đã nhận, 4=Đang hoàn,
    //   5=Đã hoàn, 6/-1=Đã huỷ, 7=Đã xóa, 8=Đang đóng hàng, 9=Chờ chuyển hàng,
    //   11=Chờ hàng. Khớp 1-1 với các cột trong sheet "TỔNG HỢP" của team.
    // Đơn nháp/trùng: đơn đã huỷ nhưng mang tag "Đơn nháp"/"Đơn trùng" — tách ra
    //   khỏi "Đã huỷ" và loại khỏi mẫu số "Tổng đơn giao" (giống các report khác).
    // Nguồn: loại TikTok/Shopee (sàn TMĐT có flow CSKH riêng) để khớp filter POS.
    //   "Webcake" của Pancake đã được detectSource map về manual/medusa.
    // from/to đã là biên UTC chuẩn theo giờ VN do frontend (toISO) tính sẵn.
    const nhapTrungCond = `
      status IN (6, -1)
      AND (tags @> '[{"name":"Đơn nháp"}]'::jsonb OR tags @> '[{"name":"Đơn trùng"}]'::jsonb)
    `
    const { rows } = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(marketer_name), ''), 'Không rõ') as marketer,
        COUNT(*) FILTER (WHERE status = 3)::int                            as da_nhan,
        COUNT(*) FILTER (WHERE status = 5)::int                            as da_hoan,
        COUNT(*) FILTER (WHERE status = 4)::int                            as dang_hoan,
        COUNT(*) FILTER (WHERE status IN (6, -1) AND NOT (${nhapTrungCond}))::int as da_huy,
        COUNT(*) FILTER (WHERE ${nhapTrungCond})::int                      as don_nhap_trung,
        COUNT(*) FILTER (WHERE status = 7)::int                            as da_xoa,
        COUNT(*) FILTER (WHERE status = 2)::int                            as da_gui_hang,
        COUNT(*) FILTER (WHERE status = 0)::int                            as moi,
        COUNT(*) FILTER (WHERE status = 11)::int                           as cho_hang,
        COUNT(*) FILTER (WHERE status = 1)::int                            as da_xac_nhan,
        COUNT(*) FILTER (WHERE status = 8)::int                            as dang_dong_hang,
        COUNT(*) FILTER (WHERE status = 9)::int                            as cho_chuyen_hang,
        COUNT(*) FILTER (WHERE status = 3)::int                            as tong_giao,
        COUNT(*)::int                                                       as tong_don
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND pancake_created_at BETWEEN $1 AND $2
        AND source NOT IN ('tiktok', 'shopee')
      GROUP BY marketer_name
      ORDER BY da_nhan DESC
    `, [from, to])

    // Tổng đơn giao (N) = tổng mọi cột status − Đã xóa − Đơn nháp/trùng.
    // Mọi tỷ lệ tính trên N này (khớp công thức sheet, tỷ lệ hoàn = 6.56% đã verify).
    const enriched = rows.map((r) => {
      const n = (r.tong_don || 0) - (r.da_xoa || 0) - (r.don_nhap_trung || 0)
      const pct = (part: number) => n > 0 ? Math.round(part / n * 1000) / 10 : 0
      const ty_le_hoan = pct(r.dang_hoan + r.da_hoan)
      const ty_le_huy = pct(r.da_huy)
      return {
        ...r,
        tong_don_giao: n,
        ty_le_hoan,
        ty_le_huy,
        ty_le_giao: pct(r.da_nhan),
        hoan_huy: Math.round((ty_le_hoan + ty_le_huy) * 10) / 10,
        du_kien_hoan_huy: pct(r.da_hoan + r.dang_hoan + r.da_huy + r.da_gui_hang / 3),
      }
    })

    // TỔNG row — tính từ tổng count rồi mới ra tỷ lệ (không cộng tỷ lệ từng dòng).
    const sum = (field: string) => enriched.reduce((acc, r) => acc + (r[field] || 0), 0)
    const t = {
      da_nhan: sum("da_nhan"), da_hoan: sum("da_hoan"), dang_hoan: sum("dang_hoan"),
      da_huy: sum("da_huy"), don_nhap_trung: sum("don_nhap_trung"), da_xoa: sum("da_xoa"),
      da_gui_hang: sum("da_gui_hang"), moi: sum("moi"), cho_hang: sum("cho_hang"),
      da_xac_nhan: sum("da_xac_nhan"), dang_dong_hang: sum("dang_dong_hang"),
      cho_chuyen_hang: sum("cho_chuyen_hang"), tong_giao: sum("tong_giao"),
      tong_don_giao: sum("tong_don_giao"),
    }
    const N = t.tong_don_giao
    const pctT = (part: number) => N > 0 ? Math.round(part / N * 1000) / 10 : 0
    const ty_le_hoan = pctT(t.dang_hoan + t.da_hoan)
    const ty_le_huy = pctT(t.da_huy)
    const summary = {
      marketer: "TỔNG",
      ...t,
      ty_le_hoan,
      ty_le_huy,
      ty_le_giao: pctT(t.da_nhan),
      hoan_huy: Math.round((ty_le_hoan + ty_le_huy) * 10) / 10,
      du_kien_hoan_huy: pctT(t.da_hoan + t.dang_hoan + t.da_huy + t.da_gui_hang / 3),
    }

    return res.json({ rows: enriched, summary })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
