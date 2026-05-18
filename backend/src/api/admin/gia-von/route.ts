import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

function calcFinalPrice(row: any): number {
  const total =
    (row.amount ?? row.qty * row.price_unit) +
    (row.local_fee_tq ?? 0) +
    (row.ship_fee_ovs ?? 0) +
    (row.local_fee_vn ?? 0) +
    (row.vat_fee ?? 0) +
    (row.other_fee ?? 0)
  return row.qty > 0 ? Math.round((total / row.qty) * 100) / 100 : 0
}

/**
 * GET /admin/gia-von?product_id=&page=1&limit=20
 * List lô nhập hàng
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string>
    const product_id = q.product_id ?? ""
    const page = Math.max(1, Number(q.page ?? 1))
    const limit = Math.min(100, Number(q.limit ?? 20))
    const offset = (page - 1) * limit

    const pool = getPool()
    const params: any[] = []
    let where = "WHERE 1=1"
    if (product_id) {
      params.push(product_id)
      where += ` AND product_id = $${params.length}`
    }

    const { rows } = await pool.query(
      `SELECT * FROM import_lot ${where} ORDER BY lot_date DESC, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    )
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total FROM import_lot ${where}`,
      params
    )

    return res.json({ lots: rows, total: Number(countRows[0].total), page, limit })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/gia-von
 * Tạo lô nhập mới, tự tính final_price và upsert product_cost (bình quân gia quyền)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = req.body as any
    const {
      product_id, product_title, lot_date, received_date,
      qty, price_unit, local_fee_tq = 0, ship_fee_ovs = 0,
      local_fee_vn = 0, vat_fee = 0, other_fee = 0,
      source = "TQ", status = "received", note = "",
    } = body

    if (!product_id || !product_title || !lot_date || !qty || !price_unit) {
      return res.status(400).json({ error: "Thiếu trường bắt buộc: product_id, product_title, lot_date, qty, price_unit" })
    }

    const amount = Math.round(qty * price_unit * 100) / 100
    const final_price = calcFinalPrice({ qty, amount, local_fee_tq, ship_fee_ovs, local_fee_vn, vat_fee, other_fee })

    const pool = getPool()

    // Insert lô mới
    const { rows: [lot] } = await pool.query(`
      INSERT INTO import_lot
        (id, product_id, product_title, lot_date, received_date, qty, price_unit, amount,
         local_fee_tq, ship_fee_ovs, local_fee_vn, vat_fee, other_fee, final_price,
         source, status, note, created_by, created_at, updated_at)
      VALUES
        (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), now())
      RETURNING *
    `, [product_id, product_title, lot_date, received_date ?? null,
        qty, price_unit, amount, local_fee_tq, ship_fee_ovs,
        local_fee_vn, vat_fee, other_fee, final_price,
        source, status, note, (req as any).user?.email ?? null])

    // Upsert product_cost — bình quân gia quyền di động
    await pool.query(`
      INSERT INTO product_cost (id, product_id, product_title, avg_cost, stock_qty, total_lots, last_imported_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, $5, now())
      ON CONFLICT (product_id) DO UPDATE SET
        product_title    = EXCLUDED.product_title,
        avg_cost         = ROUND(
          (product_cost.stock_qty * product_cost.avg_cost + $4 * $3) /
          NULLIF(product_cost.stock_qty + $4, 0)
        , 2),
        stock_qty        = product_cost.stock_qty + $4,
        total_lots       = product_cost.total_lots + 1,
        last_imported_at = GREATEST(product_cost.last_imported_at, $5),
        updated_at       = now()
    `, [product_id, product_title, final_price, qty, lot_date])

    return res.json({ lot })
  } catch (err: any) {
    console.error("[gia-von POST]", err)
    res.status(500).json({ error: err?.message ?? String(err), stack: err?.stack?.split("\n").slice(0,3) })
    return
  }
}
