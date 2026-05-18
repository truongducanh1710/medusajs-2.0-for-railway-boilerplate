import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/gia-von/summary
 * Tổng quan giá vốn tất cả sản phẩm
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string>
    const search = q.search ?? ""

    const pool = getPool()
    const params: any[] = []
    let where = "WHERE 1=1"
    if (search) {
      params.push(`%${search.toLowerCase()}%`)
      where += ` AND LOWER(product_title) LIKE $${params.length}`
    }

    const { rows } = await pool.query(
      `SELECT product_id, product_title, avg_cost, stock_qty, total_lots, last_imported_at, updated_at
       FROM product_cost ${where} ORDER BY updated_at DESC`,
      params
    )

    return res.json({ products: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
