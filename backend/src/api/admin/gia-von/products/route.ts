import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/gia-von/products
 * Lấy danh sách SP từ mkt_product để làm dropdown trong bảng giá vốn.
 * Chỉ cần page.gia-von.view (đã guard ở middlewares.ts: /admin/gia-von*)
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const { rows } = await pool.query(
      `SELECT id, name, code, pancake_id FROM mkt_product WHERE active = true ORDER BY name ASC`
    )
    return res.json({ products: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
