import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/gia-von/sheet/columns — ĐÃ KHOÁ.
 *
 * Bảng dữ liệu giá vốn dùng bộ cột cố định (SHEET_SCHEMA); thêm cột tự do khiến
 * báo cáo giá TB đọc lệch nên chặn hẳn ở API, không chỉ ẩn nút trên UI.
 */
export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  return res.status(403).json({
    error: "Bảng dữ liệu giá vốn dùng bộ cột cố định — không thêm cột mới được.",
  })
}
