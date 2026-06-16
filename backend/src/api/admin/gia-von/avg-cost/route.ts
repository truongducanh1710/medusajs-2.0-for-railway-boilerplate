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

export interface AvgCostResult {
  costs: Record<string, number>   // code → giá TB
  byName: Record<string, number>  // TÊN SP CHÍNH (upper) → giá TB
  mapped: number
  total: number
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
    return { costs: {}, byName: {}, mapped: 0, total: 0 }
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
  const colNhom = posToId[10] // cột K = nhóm SP (product autocomplete)

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

  // Load mkt_product để map tên → code
  const { rows: products } = await pool.query(
    `SELECT name, code FROM mkt_product WHERE active = true`
  )
  const nameToCode: Record<string, string> = {}
  for (const p of products) {
    if (p.name && p.code) nameToCode[String(p.name).trim().toUpperCase()] = p.code
  }

  const costs: Record<string, number> = {}
  const byName: Record<string, number> = {}
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

    // Map sang code qua mkt_product (so khớp tên SP chính)
    const code = nameToCode[tenChinh.toUpperCase()]
    if (code) {
      costs[code] = giaTB
      mapped++
    }
  }

  return { costs, byName, mapped, total }
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
