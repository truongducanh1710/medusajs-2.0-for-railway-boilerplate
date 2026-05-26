import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * PUT /admin/gia-von/:id
 * Cập nhật lô nhập, recalculate final_price và upsert product_cost avg
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params as { id: string }
    const body = req.body as any
    const pool = getPool()

    const qty        = Number(body.qty ?? 0)
    const price_unit = Number(body.price_unit ?? 0)
    const local_fee_tq  = Number(body.local_fee_tq ?? 0)
    const ship_fee_ovs  = Number(body.ship_fee_ovs ?? 0)
    const local_fee_vn  = Number(body.local_fee_vn ?? 0)
    const vat_fee       = Number(body.vat_fee ?? 0)
    const other_fee     = Number(body.other_fee ?? 0)
    const lot_date      = body.lot_date ?? ""
    const received_date = body.received_date || null
    const product_title = body.product_title ?? ""
    const source             = body.source ?? "TQ"
    const status             = body.status ?? "received"
    const note               = body.note ?? ""
    const parent_product_id  = body.parent_product_id || null

    if (!qty || !price_unit || !lot_date) {
      return res.status(400).json({ error: "Thiếu qty / price_unit / lot_date" })
    }

    const amount = Math.round(qty * price_unit * 100) / 100
    const total  = amount + local_fee_tq + ship_fee_ovs + local_fee_vn + vat_fee + other_fee
    const final_price = qty > 0 ? Math.round((total / qty) * 100) / 100 : 0

    const { rows } = await pool.query(
      `UPDATE import_lot SET
         product_title = $1, lot_date = $2, received_date = $3,
         qty = $4, price_unit = $5, amount = $6,
         local_fee_tq = $7, ship_fee_ovs = $8, local_fee_vn = $9,
         vat_fee = $10, other_fee = $11, final_price = $12,
         source = $13, status = $14, note = $15,
         parent_product_id = $16, updated_at = now()
       WHERE id = $17
       RETURNING *`,
      [product_title, lot_date, received_date,
       qty, price_unit, amount,
       local_fee_tq, ship_fee_ovs, local_fee_vn,
       vat_fee, other_fee, final_price,
       source, status, note,
       parent_product_id, id]
    )
    if (!rows.length) return res.status(404).json({ error: "Không tìm thấy lô" })

    const affected_product_id = rows[0].product_id
    const parent_id = rows[0].parent_product_id

    // Recalculate avg_cost cho SP này (chỉ lô của chính nó, không tính phụ kiện)
    await pool.query(`
      UPDATE product_cost SET
        avg_cost  = sub.avg,
        stock_qty = sub.total_qty,
        total_lots = sub.cnt,
        updated_at = now()
      FROM (
        SELECT product_id,
               ROUND(SUM(final_price * qty) / NULLIF(SUM(qty),0), 2) as avg,
               SUM(qty) as total_qty,
               COUNT(*) as cnt
        FROM import_lot WHERE product_id = $1 AND (parent_product_id IS NULL OR parent_product_id = '')
        GROUP BY product_id
      ) sub
      WHERE product_cost.product_id = sub.product_id
    `, [affected_product_id])

    // Nếu lô này là phụ kiện (có parent_product_id) → recalc SP chính gộp thêm phụ kiện
    // Công thức: avg_cost_SP_chinh = (SUM(final*qty của SP chính) + SUM(final*qty phụ kiện trỏ về SP chính)) / SUM(qty SP chính)
    if (parent_id) {
      await pool.query(`
        UPDATE product_cost SET
          avg_cost   = sub.blended_avg,
          updated_at = now()
        FROM (
          SELECT
            main.product_id,
            ROUND(
              (COALESCE(SUM(CASE WHEN il.product_id = main.product_id AND (il.parent_product_id IS NULL OR il.parent_product_id = '') THEN il.final_price * il.qty ELSE 0 END), 0)
               + COALESCE(SUM(CASE WHEN il.parent_product_id = main.product_id THEN il.final_price * il.qty ELSE 0 END), 0))
              / NULLIF(SUM(CASE WHEN il.product_id = main.product_id AND (il.parent_product_id IS NULL OR il.parent_product_id = '') THEN il.qty ELSE 0 END), 0)
            , 2) as blended_avg
          FROM product_cost main
          JOIN import_lot il ON (il.product_id = main.product_id OR il.parent_product_id = main.product_id)
          WHERE main.product_id = $1
          GROUP BY main.product_id
        ) sub
        WHERE product_cost.product_id = sub.product_id
      `, [parent_id])
    }

    return res.json({ lot: rows[0] })
  } catch (err: any) {
    console.error("[gia-von PUT]", err.message)
    return res.status(500).json({ error: err.message })
  }
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
