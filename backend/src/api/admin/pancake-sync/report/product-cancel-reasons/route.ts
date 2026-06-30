import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { resolveDisplayId, DISPLAY_ID_ALIASES } from "../../../gia-von/avg-cost/route"

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
 * Định nghĩa cột lý do hủy/hoàn. `match`: prefix (kết "_") hoặc tên tag chính xác.
 * Thứ tự trong mảng = thứ tự ưu tiên khi 1 đơn có nhiều tag (đơn hoàn ưu tiên Hoan_* trước).
 */
type Reason = { key: string; label: string; group: string; match: string[] }
const REASON_TAGS: Reason[] = [
  // Lý do hoàn (ưu tiên cao nhất cho đơn hoàn)
  { key: "hoan_sp",      label: "Do sản phẩm",      group: "Lý do hoàn", match: ["Hoan_DoSanPham"] },
  { key: "hoan_khach",   label: "Do khách",         group: "Lý do hoàn", match: ["Hoan_DoKhach"] },
  { key: "hoan_lienlac", label: "Không liên lạc",   group: "Lý do hoàn", match: ["Hoan_DoKhongLienLacDuoc"] },
  { key: "hoan_dvvc",    label: "Do ĐVVC",          group: "Lý do hoàn", match: ["Hoan_DoDVVC"] },
  { key: "hoan_lau",     label: "Giao hàng lâu",    group: "Lý do hoàn", match: ["Hoan_GiaoHangLau"] },
  { key: "hoan_kho",     label: "Do kho",           group: "Lý do hoàn", match: ["Hoan_DoKho"] },
  // Lý do từ Khách
  { key: "kh_doiy",      label: "Đổi ý",            group: "Lý do từ Khách", match: ["LyDo_DoiY"] },
  { key: "kh_muaben",    label: "Mua bên khác",     group: "Lý do từ Khách", match: ["LyDo_MuaBenKhac", "Khách đã nhận hàng bên khác"] },
  { key: "kh_giacao",    label: "Giá cao",          group: "Lý do từ Khách", match: ["LyDo_GiaCao"] },
  { key: "kh_khongphuhop", label: "Không phù hợp",  group: "Lý do từ Khách", match: ["LyDo_KhongPhuHop"] },
  { key: "kh_bom",       label: "Khách bom",        group: "Lý do từ Khách", match: ["KhachDaBom"] },
  { key: "kh_khongdat",  label: "Không đặt",        group: "Lý do từ Khách", match: ["Khách không đặt"] },
  // Lỗi liên lạc
  { key: "ll_khongnghe", label: "Không nghe máy",   group: "Lỗi liên lạc", match: ["LyDo_KhongNgheMay", "Không nghe"] },
  { key: "ll_thuebao",   label: "Thuê bao",         group: "Lỗi liên lạc", match: ["LyDo_ThueBao"] },
  // Lỗi dữ liệu đơn
  { key: "dl_saiso",     label: "Sai số",           group: "Lỗi dữ liệu đơn", match: ["LyDo_SaiSo", "sai số"] },
  { key: "dl_thieudc",   label: "Thiếu địa chỉ",    group: "Lỗi dữ liệu đơn", match: ["Thiếu địa chỉ"] },
]
const NO_TAG = { key: "chua_gan", label: "Chưa gắn thẻ", group: "Khác" }

function matchReason(tagNames: string[]): string {
  const lower = tagNames.map(t => t.toLowerCase())
  for (const r of REASON_TAGS) {
    for (const m of r.match) {
      const ml = m.toLowerCase()
      if (lower.some(t => t === ml || t.startsWith(ml))) return r.key
    }
  }
  return NO_TAG.key
}

/**
 * GET /admin/pancake-sync/report/product-cancel-reasons?from=...&to=...
 * Ma trận SP × lý do hủy/hoàn (đơn status 6,-1,4,5). Mỗi đơn gán 1 SP chính + 1 lý do ưu tiên.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
    } = req.query as Record<string, string>

    const prodNames = await sql(`SELECT code, name FROM mkt_product WHERE active = true`)
    const codeToName: Record<string, string> = {}
    for (const p of prodNames) if (p.code) codeToName[String(p.code).trim().toUpperCase()] = p.name

    const aliasCases = Object.entries(DISPLAY_ID_ALIASES)
      .map(([f, t]) => `WHEN '${f}' THEN '${t}'`).join("\n          ")
    const resolveSql = (expr: string) => `
      CASE upper(trim(${expr}))
          ${aliasCases}
          ELSE upper(trim(${expr}))
      END`

    const tagNhap = `tags @> '[{"name":"Đơn nháp"}]'::jsonb`
    const tagTrung = `tags @> '[{"name":"Đơn trùng"}]'::jsonb`

    // SP chính + tags + status mỗi đơn hủy/hoàn (đã loại nháp/trùng/xóa).
    const rows = await sql(`
      SELECT DISTINCT ON (po.id)
        po.id,
        po.status,
        ${resolveSql("mi->'variation_info'->>'display_id'")} AS sp_code,
        upper(trim(COALESCE(mi->'variation_info'->>'name', mi->>'name', ''))) AS sp_name_up,
        COALESCE(mi->'variation_info'->>'name', mi->>'name', 'CHƯA RÕ SP') AS sp_label,
        (SELECT array_agg(t->>'name')
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(po.tags::jsonb) = 'array' THEN po.tags::jsonb ELSE '[]'::jsonb END
           ) t) AS tag_names
      FROM pancake_order po
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items', '[]'::jsonb)) AS mi
      WHERE po.deleted_at IS NULL
        AND po.status IN (6, -1, 4, 5)
        AND po.source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
        AND NOT (${tagNhap} AND po.status IN (6, -1))
        AND NOT (${tagTrung} AND po.status IN (6, -1))
        AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND po.pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND po.raw->'items' IS NOT NULL
      ORDER BY po.id,
        (COALESCE((mi->'variation_info'->>'retail_price')::numeric, (mi->>'price')::numeric, 0)
          * COALESCE((mi->>'quantity')::numeric, 1)) DESC NULLS LAST
    `, [from, to])

    // Gom theo SP, đếm theo lý do ưu tiên + tổng hủy/hoàn.
    const reasonKeys = [...REASON_TAGS.map(r => r.key), NO_TAG.key]
    const spMap: Record<string, any> = {}
    for (const row of rows) {
      const key = (row.sp_code && String(row.sp_code).trim()) || row.sp_name_up || "CHƯA RÕ SP"
      if (!spMap[key]) {
        const stdName = row.sp_code ? codeToName[String(row.sp_code).toUpperCase()] : null
        spMap[key] = {
          sp_label: stdName || row.sp_label, sp_code: row.sp_code || null,
          tong_huy: 0, tong_hoan: 0,
          ...Object.fromEntries(reasonKeys.map(k => [k, 0])),
        }
      }
      const g = spMap[key]
      const isHoan = row.status === 4 || row.status === 5
      if (isHoan) g.tong_hoan++; else g.tong_huy++
      const reason = matchReason(row.tag_names || [])
      g[reason]++
    }

    const result = Object.values(spMap)
      .map((g: any) => ({ ...g, tong: g.tong_huy + g.tong_hoan }))
      .sort((a, b) => b.tong - a.tong)

    // Totals
    const totals: any = { sp_label: "TỔNG", tong_huy: 0, tong_hoan: 0, tong: 0 }
    for (const k of reasonKeys) totals[k] = 0
    for (const r of result) {
      totals.tong_huy += r.tong_huy; totals.tong_hoan += r.tong_hoan; totals.tong += r.tong
      for (const k of reasonKeys) totals[k] += r[k]
    }

    return res.json({
      rows: result,
      totals,
      reasons: [...REASON_TAGS.map(({ key, label, group }) => ({ key, label, group })),
                { key: NO_TAG.key, label: NO_TAG.label, group: NO_TAG.group }],
      from, to,
    })
  } catch (err: any) {
    console.error("[report/product-cancel-reasons]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
