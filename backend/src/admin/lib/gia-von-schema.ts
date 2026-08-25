/**
 * Schema CỐ ĐỊNH của bảng dữ liệu giá vốn (cost_sheet_column / cost_sheet_row).
 *
 * Trước đây bảng là spreadsheet tự do 26 cột A-Z, ai cũng thêm/xoá/đổi tên cột và
 * gõ chữ vào ô số được -> báo cáo giá TB đọc nhầm, mua hàng phải dò tay. Từ nay
 * cấu trúc khoá cứng ở đây, dùng chung cho cả API lẫn màn hình admin.
 *
 * Vị trí cột PHẢI khớp quy ước mà computeAvgCost() và SummaryTab đang đọc:
 *   B(1) Sản phẩm · C(2) Tính chất · D(3) Số lượng · I(8) Tổng tiền · K(10) Mã SP
 */

export type ColKind = "text" | "number" | "enum" | "product"

export type SheetColSpec = {
  position: number
  /** Tên hiển thị — cũng là khoá mà computeAvgCost dò trong dòng header. */
  name: string
  /** col_type lưu DB: chỉ có text | number (enum/product vẫn là text). */
  col_type: "text" | "number"
  /** Kiểu nghiệp vụ, quyết định cách nhập liệu + validate ở UI. */
  kind: ColKind
  /** Ô do công thức sinh ra — sửa tay được nhưng sẽ bị cảnh báo khi lệch. */
  formula?: boolean
  width: number
  /** Giá trị hợp lệ, chỉ dùng cho kind "enum". */
  options?: readonly string[]
}

/** Hai giá trị hợp lệ của cột "Tính chất" — backend so khớp TUYỆT ĐỐI chuỗi này. */
export const TINH_CHAT = ["Sản phẩm chính", "Phụ kiện"] as const

export const SHEET_SCHEMA: readonly SheetColSpec[] = [
  { position: 0,  name: "STT",       col_type: "text",   kind: "text",    width: 60 },
  { position: 1,  name: "Sản phẩm",  col_type: "text",   kind: "product", width: 260 },
  { position: 2,  name: "Tính chất", col_type: "text",   kind: "enum",    width: 130, options: TINH_CHAT },
  { position: 3,  name: "Số lượng",  col_type: "number", kind: "number",  width: 90 },
  { position: 4,  name: "Đơn giá",   col_type: "number", kind: "number",  width: 110 },
  { position: 5,  name: "Phí",       col_type: "number", kind: "number",  width: 110 },
  { position: 6,  name: "VAT",       col_type: "number", kind: "number",  width: 110, formula: true },
  { position: 7,  name: "Phí khác",  col_type: "number", kind: "number",  width: 110 },
  { position: 8,  name: "Tổng tiền", col_type: "number", kind: "number",  width: 130, formula: true },
  { position: 9,  name: "Giá TB/sp", col_type: "number", kind: "number",  width: 120, formula: true },
  { position: 10, name: "Mã SP",     col_type: "text",   kind: "product", width: 140 },
] as const

/** Số cột cố định — mọi cột position >= giá trị này là cột thừa cần dọn. */
export const SHEET_COL_COUNT = SHEET_SCHEMA.length

export function specAt(position: number): SheetColSpec | undefined {
  return SHEET_SCHEMA.find(c => c.position === position)
}

/**
 * Giá trị có hợp lệ với kiểu cột không. Ô trống luôn hợp lệ (chưa nhập).
 * Số chấp nhận cả dạng vi-VN "1.234.567" lẫn "1234567" / "1234,5".
 */
export function isValidCell(spec: SheetColSpec | undefined, raw: string): boolean {
  const v = String(raw ?? "").trim()
  if (!v) return true
  if (!spec) return true
  if (spec.kind === "enum") return (spec.options ?? []).includes(v as any)
  if (spec.col_type === "number") return !isNaN(parseNumLoose(v))
  return true
}

/** "1.234.567" | "1234,5" | "1234" -> number; không parse được trả NaN. */
export function parseNumLoose(raw: string): number {
  const v = String(raw ?? "").trim()
  if (!v) return NaN
  // Bỏ dấu chấm ngăn nghìn kiểu vi-VN, đổi dấu phẩy thập phân thành chấm.
  const norm = v.replace(/\./g, "").replace(",", ".")
  return /^-?\d+(\.\d+)?$/.test(norm) ? Number(norm) : NaN
}
