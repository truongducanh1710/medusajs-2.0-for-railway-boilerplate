import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * DELETE /admin/gia-von/cpqc/:id
 * Xoá 1 bản ghi lưu nhầm.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params as Record<string, string>
    await getPool().query(`DELETE FROM cpqc_target WHERE id = $1`, [id])
    return res.json({ id, deleted: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
