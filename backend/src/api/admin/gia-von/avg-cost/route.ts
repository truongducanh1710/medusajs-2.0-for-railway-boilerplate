import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

function parseNum(s: string): number {
  if (!s) return 0
  return parseFloat(String(s).replace(/\./g, "").replace(",", ".")) || 0
}

/**
 * Alias display_id Pancake (biến thể/lệch mã) → code chuẩn trong mkt_product.
 * Pancake sinh biến thể (màu/size) bằng hậu tố riêng, hoặc mã gốc bị nhập lệch số/dấu
 * so với mkt_product — alias để vẫn map đúng giá vốn mà không phải đổi mã trong Pancake.
 */
export const DISPLAY_ID_ALIASES: Record<string, string> = {
  PHVVN027_CV: "PHVVN026_CV",
  PHVVN020_TDH_LARGE: "PHVVN020_TDH",
  PHVVN020_TDH_MEDIUM: "PHVVN020_TDH",
  PHVVN023_GDQA: "PHVVN023_GĐQA",
  PHVVN033_NS: "PHVVN033_NCDTMS",
  PHVVN030_NAS_CAM: "PHVVN030_NAS",
  PHVVN030_NAS_TRANG: "PHVVN030_NAS",
  PHVVN032_NASV: "PHVVN032_NASĐN",
  // Phụ kiện bán lẻ độc lập — giá vốn riêng không tách được khỏi SP chính trong sheet,
  // dùng tạm giá vốn SP chính (số lượng bán lẻ rất nhỏ, không đáng kể với LNG tổng).
  PHVVN004_GBLN: "PHVVN003_BLN",
  PHVVN015_MXCLN: "PHVVN010_CLXOP",
  PHVVN041_GBCX: "PHVVN031_BCX",
}

export function resolveDisplayId(displayId: string | null | undefined): string | null {
  if (!displayId) return null
  const upper = displayId.trim().toUpperCase()
  return DISPLAY_ID_ALIASES[upper] ?? upper
}

/**
 * Chuẩn hoá tham số from/to của report về NGÀY LỊCH VN (YYYY-MM-DD).
 *
 * Các report LNG lọc đơn bằng `$1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`
 * theo pancake_created_at (= thời điểm TẠO đơn). Frontend lại gửi `from`/`to` dạng ISO
 * UTC đã trừ 7h để trỏ mốc 00:00 VN, vd "2026-05-31T17:00:00.000Z" = 00:00 ngày 01/06 VN.
 * Nếu ép `::date` thẳng, "…T17:00Z" bị PostgreSQL cắt còn 2026-05-31 → query lệch sớm 1
 * ngày, gộp nhầm đơn tạo ngày hôm trước vào kỳ (giá vốn/doanh thu tăng ảo).
 *
 * Fix: nếu chuỗi có phần giờ, cộng lại 7h rồi lấy phần ngày → khôi phục đúng ngày VN;
 * nếu đã là YYYY-MM-DD thì giữ nguyên.
 */
export function toVNDate(s: string | null | undefined): string {
  const str = String(s ?? "")
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  const d = new Date(str)
  if (isNaN(d.getTime())) return str.slice(0, 10)
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
}

export interface AvgCostResult {
  costs: Record<string, number>   // code → giá TB
  byName: Record<string, number>  // TÊN SP CHÍNH (upper) → giá TB
  mapped: number
  total: number
  unlinked: { label: string; gia_tb: number }[]  // nhóm không khớp được mã (cũ: lệch tên; mới: K trống/không phải mã hợp lệ)
}

/**
 * Tính giá vốn trung bình / sản phẩm từ bảng gia-von (tab Tổng kết giá TB),
 * map sang code (display_id) qua mkt_product.
 *
 * Logic khớp SummaryTab trong admin/routes/gia-von/page.tsx:
 *   Giá TB/sp = (Tổng tiền SP chính + Tổng tiền phụ kiện cùng nhóm) / SL SP chính
 *
 * Dùng chung bởi GET handler + báo cáo marketer-lng.
 */
export async function computeAvgCost(pool: Pool): Promise<AvgCostResult> {
  const { rows: columns } = await pool.query(
    `SELECT id, position FROM cost_sheet_column ORDER BY position ASC`
  )
  const { rows: sheetRows } = await pool.query(
    `SELECT id, position, data FROM cost_sheet_row ORDER BY position ASC`
  )
  if (sheetRows.length < 2) {
    return { costs: {}, byName: {}, mapped: 0, total: 0, unlinked: [] }
  }

  // pos → colId
  const posToId: Record<number, string> = {}
  for (const c of columns) posToId[c.position] = c.id

  // Dòng đầu = header row → headerValue → colId
  const headerRow = sheetRows[0].data as Record<string, string>
  const headerToId: Record<string, string> = {}
  for (const [colId, val] of Object.entries(headerRow)) {
    if (val) headerToId[String(val).trim()] = colId
  }

  const colSanPham = headerToId["Sản phẩm"] ?? posToId[1]
  const colTinhChat = headerToId["Tính chất"] ?? posToId[2]
  const colSoLuong = headerToId["Số lượng"] ?? posToId[3]
  const colTongTien = headerToId["Tổng tiền"] ?? posToId[8]
  const colNhom = posToId[10] // cột K = nhóm SP (product autocomplete) — lưu mã SP (code); dữ liệu cũ có thể vẫn là tên

  type Group = { tenChinh: string; nhom: string; soLuong: number; tongTienChinh: number; tongTienPhuKien: number }
  const groupMap: Record<string, Group> = {}

  for (const r of sheetRows.slice(1)) {
    const d = r.data as Record<string, string>
    const ten = (d[colSanPham] ?? "").trim()
    if (!ten) continue
    const tinhChat = (d[colTinhChat] ?? "").trim()
    const nhom = (colNhom ? d[colNhom] : "")?.trim() ?? ""
    const soLuong = parseNum(d[colSoLuong] ?? "")
    const tongTien = parseNum(d[colTongTien] ?? "")

    const key = nhom || ten
    if (!groupMap[key]) {
      groupMap[key] = { tenChinh: "", nhom, soLuong: 0, tongTienChinh: 0, tongTienPhuKien: 0 }
    }
    const g = groupMap[key]
    if (tinhChat === "Sản phẩm chính") {
      g.tenChinh = ten
      g.soLuong += soLuong
      g.tongTienChinh += tongTien
    } else {
      g.tongTienPhuKien += tongTien
    }
  }

  // Load mkt_product để map mã/tên → code
  const { rows: products } = await pool.query(
    `SELECT name, code FROM mkt_product WHERE active = true`
  )
  const nameToCode: Record<string, string> = {}
  const codeSet = new Set<string>()
  for (const p of products) {
    if (p.name && p.code) nameToCode[String(p.name).trim().toUpperCase()] = p.code
    if (p.code) codeSet.add(String(p.code).trim().toUpperCase())
  }

  const costs: Record<string, number> = {}
  const byName: Record<string, number> = {}
  const unlinked: { label: string; gia_tb: number }[] = []
  let mapped = 0
  let total = 0

  for (const g of Object.values(groupMap)) {
    if (!g.tenChinh && g.soLuong === 0) continue
    total++
    const giaTB = g.soLuong > 0
      ? Math.round((g.tongTienChinh + g.tongTienPhuKien) / g.soLuong)
      : 0
    const tenChinh = g.tenChinh || g.nhom
    byName[tenChinh.toUpperCase()] = giaTB

    // Ưu tiên: cột K (nhóm) lưu trực tiếp mã SP (code) — khớp tuyệt đối, không qua tên
    // Fallback (dữ liệu cũ): cột K/tên SP chính là text, so khớp với mkt_product.name
    const nhomUpper = g.nhom.trim().toUpperCase()
    const code = (nhomUpper && codeSet.has(nhomUpper))
      ? nhomUpper
      : nameToCode[nhomUpper] ?? nameToCode[tenChinh.toUpperCase()]
    if (code) {
      costs[code] = giaTB
      mapped++
    } else {
      unlinked.push({ label: tenChinh || g.nhom, gia_tb: giaTB })
    }
  }

  return { costs, byName, mapped, total, unlinked }
}

/**
 * GET /admin/gia-von/avg-cost
 * Trả: { costs: { "<code>": gia_tb }, byName: { "<TÊN SP CHÍNH>": gia_tb }, mapped, total }
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    const result = await computeAvgCost(getPool())
    return res.json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
