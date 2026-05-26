import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * POST /admin/gia-von/backfill
 * Tạo import_lot từ product_cost hiện có (mỗi SP 1 lô "initial import").
 * Chỉ tạo nếu SP đó chưa có import_lot nào.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()

    // Lấy tất cả product_cost chưa có import_lot nào
    const { rows: costs } = await pool.query(`
      SELECT pc.*
      FROM product_cost pc
      WHERE NOT EXISTS (
        SELECT 1 FROM import_lot il WHERE il.product_id = pc.product_id
      )
    `)

    if (!costs.length) {
      return res.json({ ok: true, created: 0, message: "Tất cả SP đã có lô nhập" })
    }

    let created = 0
    for (const c of costs) {
      const lotDate = c.last_imported_at ?? new Date().toISOString().slice(0, 10)
      const qty = c.stock_qty ?? 1
      const finalPrice = c.avg_cost ?? 0
      const amount = Math.round(qty * finalPrice * 100) / 100

      await pool.query(
        `INSERT INTO import_lot
          (id, product_id, product_title, lot_date, received_date, qty, price_unit, amount,
           local_fee_tq, ship_fee_ovs, local_fee_vn, vat_fee, other_fee, final_price,
           source, status, note, created_by, created_at, updated_at)
         VALUES
          (gen_random_uuid(), $1, $2, $3, $3, $4, $5, $6,
           0, 0, 0, 0, 0, $5,
           'CSV', 'received', '[Backfill từ import CSV]', null, now(), now())`,
        [c.product_id, c.product_title, lotDate, qty, finalPrice, amount]
      )
      created++
    }

    return res.json({ ok: true, created })
  } catch (err: any) {
    console.error("[backfill]", err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
