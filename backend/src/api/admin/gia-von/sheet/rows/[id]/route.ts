import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * DELETE /admin/gia-von/sheet/rows/:id
 * Xóa 1 dòng theo id
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const pool = getPool()
    await pool.query(`DELETE FROM cost_sheet_row WHERE id = $1`, [id])
    return res.json({ deleted: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
