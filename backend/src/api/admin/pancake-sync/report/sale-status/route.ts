import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { toVNDate } from "../../../gia-von/avg-cost/route"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
async function sql(query: string, params?: any[]): Promise<any[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(query, params ?? [])
    return result.rows
  } finally {
    client.release()
  }
}

/**
 * GET /admin/pancake-sync/report/sale-status?from=...&to=...
 * Tình trạng vận đơn theo NV SALE (sale_name) — hoàn/hủy/giao của từng sale.
 *
 * Song song report/marketer-performance nhưng gom theo SALE (người chốt đơn) thay vì
 * marketer (người chạy ads). Dùng CÙNG excludeCond + cùng cách đếm N → TỔNG khớp tab NV MKT.
 * sale_name được TRIM để gộp biến thể lệch dấu cách (vd "Linh" và " Linh" là 1 người).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from: fromRaw, to: toRaw, market } = req.query as Record<string, string>
    if (!fromRaw || !toRaw) return res.status(400).json({ error: "Thiếu from/to" })

    if (market && market !== "VN") {
      return res.json({ not_supported: true, market, rows: [] })
    }

    const from = toVNDate(fromRaw)
    const to = toVNDate(toRaw)

    // Sale attribution: TRIM để gộp lệch dấu cách; rỗng → "(chưa assign)".
    const saleExpr = `COALESCE(NULLIF(TRIM(sale_name), ''), '(chưa assign)')`

    const tagNhap = `tags @> '[{"name":"Đơn nháp"}]'::jsonb`
    const tagTrung = `tags @> '[{"name":"Đơn trùng"}]'::jsonb`
    const nhapTrungCond = `status IN (6, -1) AND (${tagNhap} OR ${tagTrung})`
    // Loại đơn (giống marketer-lng/performance): đã xóa (7) + nháp chưa xác nhận (0/11) + nháp/trùng đã huỷ.
    const excludeCond = `(
      status = 7
      OR (${tagNhap} AND status IN (0, 11))
      OR (${nhapTrungCond})
    )`

    const rows = await sql(`
      SELECT
        ${saleExpr} AS sale_name,
        COUNT(*) FILTER (WHERE status = 3 AND NOT ${excludeCond})::int                 AS da_nhan,
        COUNT(*) FILTER (WHERE status = 5 AND NOT ${excludeCond})::int                 AS da_hoan,
        COUNT(*) FILTER (WHERE status = 4 AND NOT ${excludeCond})::int                 AS dang_hoan,
        COUNT(*) FILTER (WHERE status IN (6, -1) AND NOT (${nhapTrungCond}))::int       AS da_huy,
        COUNT(*) FILTER (WHERE ${nhapTrungCond})::int                                   AS don_nhap_trung,
        COUNT(*) FILTER (WHERE status = 7)::int                                         AS da_xoa,
        COUNT(*) FILTER (WHERE status = 2 AND NOT ${excludeCond})::int                  AS da_gui_hang,
        COUNT(*) FILTER (WHERE status = 0 AND NOT ${excludeCond})::int                  AS moi,
        COUNT(*) FILTER (WHERE status = 11 AND NOT ${excludeCond})::int                 AS cho_hang,
        COUNT(*) FILTER (WHERE status = 1 AND NOT ${excludeCond})::int                  AS da_xac_nhan,
        COUNT(*) FILTER (WHERE status = 8 AND NOT ${excludeCond})::int                  AS dang_dong_hang,
        COUNT(*) FILTER (WHERE status = 9 AND NOT ${excludeCond})::int                  AS cho_chuyen_hang,
        COUNT(*) FILTER (WHERE status NOT IN (-2) AND NOT ${excludeCond})::int          AS tong_don_giao
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      GROUP BY ${saleExpr}
    `, [from, to])

    const enriched = rows.map((r: any) => {
      const n = r.tong_don_giao || 0
      const pct = (part: number) => n > 0 ? Math.round(part / n * 1000) / 10 : 0
      const ty_le_hoan = pct(r.dang_hoan + r.da_hoan)
      const ty_le_huy = pct(r.da_huy)
      return {
        ...r,
        tong_giao: r.da_nhan,
        tong_don: n,
        ty_le_hoan,
        ty_le_huy,
        ty_le_giao: pct(r.da_nhan),
        hoan_huy: Math.round((ty_le_hoan + ty_le_huy) * 10) / 10,
        du_kien_hoan_huy: pct(r.da_hoan + r.dang_hoan + r.da_huy + r.da_gui_hang / 3),
      }
    }).sort((a, b) => b.da_nhan - a.da_nhan)

    const COUNT_FIELDS = [
      "da_nhan", "da_hoan", "dang_hoan", "da_huy", "don_nhap_trung", "da_xoa",
      "da_gui_hang", "moi", "cho_hang", "da_xac_nhan", "dang_dong_hang",
      "cho_chuyen_hang", "tong_don_giao",
    ]
    const sum = (field: string) => enriched.reduce((acc, r: any) => acc + (r[field] || 0), 0)
    const t: Record<string, any> = { sale_name: "TỔNG" }
    for (const k of COUNT_FIELDS) t[k] = sum(k)
    const N = t.tong_don_giao
    const pctT = (part: number) => N > 0 ? Math.round(part / N * 1000) / 10 : 0
    const ty_le_hoan = pctT(t.dang_hoan + t.da_hoan)
    const ty_le_huy = pctT(t.da_huy)
    const summary = {
      ...t,
      tong_giao: t.da_nhan,
      tong_don: N,
      ty_le_hoan,
      ty_le_huy,
      ty_le_giao: pctT(t.da_nhan),
      hoan_huy: Math.round((ty_le_hoan + ty_le_huy) * 10) / 10,
      du_kien_hoan_huy: pctT(t.da_hoan + t.dang_hoan + t.da_huy + t.da_gui_hang / 3),
    }

    return res.json({ rows: enriched, summary })
  } catch (err: any) {
    console.error("[report/sale-status]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
