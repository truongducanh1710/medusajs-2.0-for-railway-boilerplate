import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /store/gia-von/:product_id
 * Public API — context sản phẩm cho app ngoài
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { product_id } = req.params as { product_id: string }
    const pool = getPool()

    const { rows: [cost] } = await pool.query(
      `SELECT * FROM product_cost WHERE product_id = $1`, [product_id]
    )
    if (!cost) return res.status(404).json({ error: "Không có dữ liệu giá vốn cho sản phẩm này" })

    const { rows: lots } = await pool.query(
      `SELECT lot_date, received_date, qty, final_price, source, status, note
       FROM import_lot WHERE product_id = $1 ORDER BY lot_date DESC LIMIT 10`,
      [product_id]
    )

    return res.json({
      product_id: cost.product_id,
      product_title: cost.product_title,
      avg_cost: Number(cost.avg_cost),
      stock_qty: Number(cost.stock_qty),
      total_lots: Number(cost.total_lots),
      last_imported_at: cost.last_imported_at,
      recent_lots: lots.map((l: any) => ({
        lot_date: l.lot_date,
        received_date: l.received_date,
        qty: Number(l.qty),
        final_price: Number(l.final_price),
        source: l.source,
        status: l.status,
        note: l.note,
      })),
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
