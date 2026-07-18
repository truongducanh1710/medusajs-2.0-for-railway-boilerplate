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
 * GET /admin/pancake-sync/report/sale-kpi?from=...&to=...
 * Bảng chỉ số KPI theo Sale để tính thưởng hàng tháng.
 *
 * Cột: Tổng data, Đơn thành công, Tổng doanh thu, Doanh thu thực,
 *      Sale chốt, Up sale, Cross sale.
 *   - Tổng data / TC / Tổng DT: dùng CÙNG excludeCond + source như marketer-lng (khớp LNG).
 *   - Sale chốt / Up sale / Cross sale = doanh thu ĐƠN GIAO TC (status 3) mang tag
 *     "SALE CHỐT" / "UPSALE" / "Cross Sale" (tag Pancake, verify thực tế).
 *   - Doanh thu thực = Tổng doanh thu − Cross sale (theo công thức KPI của team).
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

    const saleExpr = `COALESCE(NULLIF(TRIM(sale_name), ''), '(chưa assign)')`
    const rev = `COALESCE(NULLIF((raw->>'total_price_after_sub_discount')::numeric, 0), cod_amount::numeric, total::numeric)`
    const tagNhap = `tags @> '[{"name":"Đơn nháp"}]'::jsonb`
    const tagTrung = `tags @> '[{"name":"Đơn trùng"}]'::jsonb`
    const nhapTrungCond = `status IN (6, -1) AND (${tagNhap} OR ${tagTrung})`
    const excludeCond = `(
      status = 7
      OR (${tagNhap} AND status IN (0, 11))
      OR (${nhapTrungCond})
    )`
    // Tag KPI (verify từ Pancake thực tế): "SALE CHỐT" / "UPSALE" / "Cross Sale".
    const hasTag = (name: string) => `tags @> '[{"name":${JSON.stringify(name)}}]'::jsonb`

    const rows = await sql(`
      SELECT
        ${saleExpr} AS sale_name,
        COUNT(*) FILTER (WHERE status NOT IN (-2) AND NOT ${excludeCond})::int                       AS tong_data,
        COUNT(*) FILTER (WHERE status = 3 AND NOT ${excludeCond})::int                                AS don_thanh_cong,
        SUM(CASE WHEN status NOT IN (-2) AND NOT ${excludeCond} THEN ${rev} ELSE 0 END)::bigint        AS tong_doanh_thu,
        -- Doanh thu thực = doanh thu đơn ĐÃ NHẬN (status 3) — KHỚP revenue_delivered của tab LNG/NV MKT.
        SUM(CASE WHEN status = 3 AND NOT ${excludeCond} THEN ${rev} ELSE 0 END)::bigint                 AS doanh_thu_thuc,
        -- Sale chốt / Up / Cross = doanh thu đơn GIAO TC (status 3) mang tag tương ứng.
        SUM(CASE WHEN status = 3 AND NOT ${excludeCond} AND ${hasTag("SALE CHỐT")} THEN ${rev} ELSE 0 END)::bigint AS sale_chot,
        SUM(CASE WHEN status = 3 AND NOT ${excludeCond} AND ${hasTag("UPSALE")}    THEN ${rev} ELSE 0 END)::bigint AS up_sale,
        SUM(CASE WHEN status = 3 AND NOT ${excludeCond} AND ${hasTag("Cross Sale")} THEN ${rev} ELSE 0 END)::bigint AS cross_sale
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      GROUP BY ${saleExpr}
    `, [from, to])

    const enriched = rows.map((r: any) => {
      return {
        sale_name: r.sale_name,
        tong_data: Number(r.tong_data),
        don_thanh_cong: Number(r.don_thanh_cong),
        tong_doanh_thu: Number(r.tong_doanh_thu),
        // Doanh thu thực = doanh thu đơn đã nhận (status 3), khớp tab NV MKT/LNG.
        doanh_thu_thuc: Number(r.doanh_thu_thuc),
        sale_chot: Number(r.sale_chot),
        up_sale: Number(r.up_sale),
        cross_sale: Number(r.cross_sale),
      }
    }).sort((a, b) => b.tong_doanh_thu - a.tong_doanh_thu)

    const FIELDS = ["tong_data", "don_thanh_cong", "tong_doanh_thu", "doanh_thu_thuc", "sale_chot", "up_sale", "cross_sale"]
    const sum = (k: string) => enriched.reduce((s, r: any) => s + (r[k] || 0), 0)
    const summary: Record<string, any> = { sale_name: "TỔNG" }
    for (const k of FIELDS) summary[k] = sum(k)

    return res.json({ rows: enriched, summary, from, to })
  } catch (err: any) {
    console.error("[report/sale-kpi]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
