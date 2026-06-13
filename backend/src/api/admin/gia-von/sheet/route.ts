import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/gia-von/sheet
 * Trả về toàn bộ columns + rows của cost sheet
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const { rows: columns } = await pool.query(
      `SELECT id, position, name, col_type, width FROM cost_sheet_column ORDER BY position ASC`
    )
    const { rows } = await pool.query(
      `SELECT id, position, data FROM cost_sheet_row ORDER BY position ASC`
    )
    return res.json({ columns, rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
