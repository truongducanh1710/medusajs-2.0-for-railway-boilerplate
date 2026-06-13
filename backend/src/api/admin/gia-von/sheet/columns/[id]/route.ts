import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * PUT /admin/gia-von/sheet/columns/:id
 * Cập nhật tên / type / width cột
 * Body: { name?, col_type?, width? }
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const body: any = req.body ?? {}
    const pool = getPool()

    const sets: string[] = []
    const params: any[] = []

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return res.status(400).json({ error: "Tên cột không được trống" })
      params.push(name)
      sets.push(`name = $${params.length}`)
    }
    if (body.col_type === "text" || body.col_type === "number") {
      params.push(body.col_type)
      sets.push(`col_type = $${params.length}`)
    }
    if (body.width !== undefined) {
      const w = Math.max(60, Math.min(Number(body.width), 500))
      params.push(w)
      sets.push(`width = $${params.length}`)
    }

    if (sets.length === 0) return res.json({ ok: true })

    params.push(id)
    const { rows: [col] } = await pool.query(
      `UPDATE cost_sheet_column SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING id, position, name, col_type, width`,
      params
    )
    if (!col) return res.status(404).json({ error: "Không tìm thấy cột" })
    return res.json({ column: col })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * DELETE /admin/gia-von/sheet/columns/:id
 * Xóa cột (key còn trong JSONB row.data là vô hại — GET chỉ render theo danh sách cột)
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const pool = getPool()
    await pool.query(`DELETE FROM cost_sheet_column WHERE id = $1`, [id])
    return res.json({ deleted: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
