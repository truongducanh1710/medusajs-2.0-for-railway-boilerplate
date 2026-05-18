import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * DELETE /admin/gia-von/:id
 * Xóa lô nhập (không recalculate avg — kế toán tự điều chỉnh nếu cần)
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params as { id: string }
    const pool = getPool()
    const { rows } = await pool.query(`DELETE FROM import_lot WHERE id = $1 RETURNING id, product_id, qty`, [id])
    if (rows.length === 0) return res.status(404).json({ error: "Không tìm thấy lô" })

    // Trừ stock_qty và total_lots
    await pool.query(`
      UPDATE product_cost
      SET stock_qty  = GREATEST(stock_qty - $2, 0),
          total_lots = GREATEST(total_lots - 1, 0),
          updated_at = now()
      WHERE product_id = $1
    `, [rows[0].product_id, rows[0].qty])

    return res.json({ ok: true, deleted_id: id })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
