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
 * GET /admin/pancake-sync/report/marketer-performance?from=...&to=...
 * Tình trạng vận đơn theo NV MKT.
 *
 * ĐỒNG BỘ với report/marketer-lng: dùng CÙNG marketer attribution (chuẩn hoá tên +
 * fallback utm + handover) và CÙNG excludeCond (loại đơn xóa + đơn nháp chưa xác nhận
 * + đơn nháp/trùng đã huỷ). Trước đây tab này GROUP BY marketer_name thô nên cùng một
 * người bị tách nhiều dòng (vd XUANLT/"NAM DV"), và đếm N gồm cả đơn nháp status 0/11
 * khiến tỷ lệ giao thấp giả — số không khớp tab LNG.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from: fromRaw, to: toRaw, market } = req.query as Record<string, string>
    if (!fromRaw || !toRaw) return res.status(400).json({ error: "Thiếu from/to" })

    if (market && market !== "VN") {
      return res.json({ not_supported: true, market, rows: [] })
    }

    // Chuẩn hoá về ngày lịch VN (xem toVNDate) — nhất quán với marketer-lng.
    const from = toVNDate(fromRaw)
    const to = toVNDate(toRaw)

    // ── Marketer attribution (copy nguyên từ marketer-lng) ─────────────────────
    const mktExpr = `
      CASE UPPER(TRIM(COALESCE(NULLIF(TRIM(raw->'marketer'->>'name'), ''), '')))
        WHEN 'NAM DV'     THEN 'NAMDV'
        WHEN 'PHẠM DU'    THEN 'DUPD'
        WHEN 'NGUYỄN MAI' THEN 'NGUYEN MAI'
        WHEN 'TRUONGAN'   THEN 'ANHTD'
        WHEN ''           THEN NULL
        ELSE UPPER(TRIM(NULLIF(TRIM(raw->'marketer'->>'name'), '')))
      END
    `
    const mktRaw = `
      COALESCE(
        ${mktExpr},
        CASE
          WHEN raw->>'p_utm_campaign' LIKE '%\\_%\\_%'
            THEN split_part(raw->>'p_utm_campaign', '_', 2)
          WHEN raw->>'p_utm_source' LIKE '%\\_%\\_%'
            THEN split_part(raw->>'p_utm_source', '_', 2)
          ELSE 'KHÁC'
        END
      )
    `
    const mktWithFallback = `CASE WHEN ${mktRaw} = 'TRUONGAN' THEN 'ANHTD' ELSE ${mktRaw} END`

    // Handover rules (áp per-day giống marketer-lng).
    let handoverRules: { from_code: string; to_code: string; effective_from: string; effective_to: string | null }[] = []
    try {
      handoverRules = await sql(
        `SELECT from_code, to_code, effective_from::text, effective_to::text FROM mkt_handover WHERE deleted_at IS NULL`
      )
    } catch { /* bảng chưa tồn tại */ }

    const tagNhap = `tags @> '[{"name":"Đơn nháp"}]'::jsonb`
    const tagTrung = `tags @> '[{"name":"Đơn trùng"}]'::jsonb`
    const nhapTrungCond = `status IN (6, -1) AND (${tagNhap} OR ${tagTrung})`
    // Đơn LOẠI khỏi mọi metric (giống marketer-lng): đã xóa (7) + đơn nháp chưa xác nhận
    // (tag nháp ở status 0/11) + đơn nháp/trùng đã huỷ (6/-1).
    const excludeCond = `(
      status = 7
      OR (${tagNhap} AND status IN (0, 11))
      OR (${nhapTrungCond})
    )`

    // Group theo (ngày, marketer) để áp handover per-day, rồi merge — như marketer-lng.
    const rows = await sql(`
      SELECT
        to_char(date_trunc('day', pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS date,
        ${mktWithFallback} AS marketer,
        COUNT(*) FILTER (WHERE status = 3 AND NOT ${excludeCond})::int                     AS da_nhan,
        COUNT(*) FILTER (WHERE status = 5 AND NOT ${excludeCond})::int                     AS da_hoan,
        COUNT(*) FILTER (WHERE status = 4 AND NOT ${excludeCond})::int                     AS dang_hoan,
        COUNT(*) FILTER (WHERE status IN (6, -1) AND NOT (${nhapTrungCond}))::int           AS da_huy,
        COUNT(*) FILTER (WHERE ${nhapTrungCond})::int                                       AS don_nhap_trung,
        COUNT(*) FILTER (WHERE status = 7)::int                                             AS da_xoa,
        COUNT(*) FILTER (WHERE status = 2 AND NOT ${excludeCond})::int                      AS da_gui_hang,
        COUNT(*) FILTER (WHERE status = 0 AND NOT ${excludeCond})::int                      AS moi,
        COUNT(*) FILTER (WHERE status = 11 AND NOT ${excludeCond})::int                     AS cho_hang,
        COUNT(*) FILTER (WHERE status = 1 AND NOT ${excludeCond})::int                      AS da_xac_nhan,
        COUNT(*) FILTER (WHERE status = 8 AND NOT ${excludeCond})::int                      AS dang_dong_hang,
        COUNT(*) FILTER (WHERE status = 9 AND NOT ${excludeCond})::int                      AS cho_chuyen_hang,
        -- Tổng đơn giao N = mọi status hợp lệ (loại -2 + excludeCond) — khớp total_orders LNG.
        COUNT(*) FILTER (WHERE status NOT IN (-2) AND NOT ${excludeCond})::int              AS tong_don_giao
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      GROUP BY date, marketer
    `, [from, to])

    // Áp handover per-day.
    for (const row of rows) {
      for (const rule of handoverRules) {
        if (
          row.marketer === rule.from_code &&
          row.date >= rule.effective_from &&
          (!rule.effective_to || row.date <= rule.effective_to)
        ) {
          row.marketer = rule.to_code
          break
        }
      }
    }

    // Merge về từng marketer.
    const COUNT_FIELDS = [
      "da_nhan", "da_hoan", "dang_hoan", "da_huy", "don_nhap_trung", "da_xoa",
      "da_gui_hang", "moi", "cho_hang", "da_xac_nhan", "dang_dong_hang",
      "cho_chuyen_hang", "tong_don_giao",
    ]
    const merged: Record<string, any> = {}
    for (const row of rows) {
      const m = row.marketer
      if (!merged[m]) {
        merged[m] = { marketer: m }
        for (const k of COUNT_FIELDS) merged[m][k] = 0
      }
      for (const k of COUNT_FIELDS) merged[m][k] += Number(row[k] ?? 0)
    }

    // Tỷ lệ tính trên N = tong_don_giao (đã loại xóa + nháp/trùng ở excludeCond).
    const enriched = Object.values(merged).map((r: any) => {
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

    // TỔNG — cộng count rồi mới ra tỷ lệ.
    const sum = (field: string) => enriched.reduce((acc, r) => acc + (r[field] || 0), 0)
    const t: Record<string, any> = { marketer: "TỔNG" }
    for (const k of COUNT_FIELDS) t[k] = sum(k)
    t.tong_giao = sum("da_nhan")
    const N = t.tong_don_giao
    const pctT = (part: number) => N > 0 ? Math.round(part / N * 1000) / 10 : 0
    const ty_le_hoan = pctT(t.dang_hoan + t.da_hoan)
    const ty_le_huy = pctT(t.da_huy)
    const summary = {
      ...t,
      tong_don: N,
      ty_le_hoan,
      ty_le_huy,
      ty_le_giao: pctT(t.da_nhan),
      hoan_huy: Math.round((ty_le_hoan + ty_le_huy) * 10) / 10,
      du_kien_hoan_huy: pctT(t.da_hoan + t.dang_hoan + t.da_huy + t.da_gui_hang / 3),
    }

    return res.json({ rows: enriched, summary })
  } catch (err: any) {
    console.error("[report/marketer-performance]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
