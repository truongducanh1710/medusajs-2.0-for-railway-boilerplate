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
      `SELECT product_id, product_title, avg_cost, stock_qty, total_lots, last_imported_at, updated_at, pancake_display_id
       FROM product_cost ${where} ORDER BY updated_at DESC`,
      params
    )

    return res.json({ products: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * PATCH /admin/gia-von/summary
 * Body: { product_id, pancake_display_id }
 * Gán display_id Pancake cho 1 SP trong product_cost
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = req.body as any
    const product_id = body.product_id as string
    const pancake_display_id = (body.pancake_display_id as string)?.trim() || null

    if (!product_id) return res.status(400).json({ error: "Thiếu product_id" })

    const pool = getPool()
    const { rows } = await pool.query(
      `UPDATE product_cost SET pancake_display_id = $1, updated_at = now()
       WHERE product_id = $2 RETURNING product_id, product_title, pancake_display_id`,
      [pancake_display_id, product_id]
    )
    if (!rows.length) return res.status(404).json({ error: "Không tìm thấy SP" })

    return res.json({ ok: true, product: rows[0] })
  } catch (err: any) {
    if (err.message?.includes("unique")) {
      return res.status(400).json({ error: `display_id này đã được gán cho SP khác` })
    }
    return res.status(500).json({ error: err.message })
  }
}

/**
 * GET /admin/gia-von/summary/pancake-ids
 * Trả danh sách tất cả display_id có trong đơn Pancake (để làm dropdown)
 */
export async function OPTIONS(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const { rows } = await pool.query(`
      SELECT DISTINCT
        item->'variation_info'->>'display_id' as display_id,
        item->'variation_info'->>'name' as name,
        item->'variation_info'->>'product_display_id' as product_display_id
      FROM pancake_order, jsonb_array_elements(raw->'items') as item
      WHERE raw->'items' IS NOT NULL
        AND item->'variation_info'->>'display_id' IS NOT NULL
      ORDER BY display_id
    `)
    return res.json({ display_ids: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
