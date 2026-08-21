import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * PUT /admin/gia-von/sheet/columns/:id — chỉ còn đổi ĐỘ RỘNG.
 *
 * Tên và kiểu cột khoá theo SHEET_SCHEMA: computeAvgCost() dò cột theo tên ở dòng
 * header, đổi tên là báo cáo giá TB đọc nhầm cột. Kéo rộng/hẹp thì vô hại nên vẫn cho.
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const body: any = req.body ?? {}

    if (body.name !== undefined || body.col_type !== undefined) {
      return res.status(403).json({
        error: "Bảng dữ liệu giá vốn dùng bộ cột cố định — không đổi tên hay kiểu cột được.",
      })
    }
    if (body.width === undefined) return res.json({ ok: true })

    const w = Math.max(60, Math.min(Number(body.width), 500))
    const pool = getPool()
    const { rows: [col] } = await pool.query(
      `UPDATE cost_sheet_column SET width = $1 WHERE id = $2
       RETURNING id, position, name, col_type, width`,
      [w, id]
    )
    if (!col) return res.status(404).json({ error: "Không tìm thấy cột" })
    return res.json({ column: col })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * DELETE /admin/gia-von/sheet/columns/:id — ĐÃ KHOÁ.
 * Xoá cột làm mất luôn dữ liệu giá vốn của cột đó và phá cấu trúc báo cáo.
 */
export async function DELETE(_req: MedusaRequest, res: MedusaResponse) {
  return res.status(403).json({
    error: "Bảng dữ liệu giá vốn dùng bộ cột cố định — không xoá cột được.",
  })
}
