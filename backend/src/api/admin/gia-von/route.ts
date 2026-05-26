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
    const search = q.search ?? ""
    const params: any[] = []
    let where = "WHERE 1=1"
    if (product_id) {
      params.push(product_id)
      where += ` AND product_id = $${params.length}`
    }
    if (search) {
      params.push(`%${search}%`)
      where += ` AND product_title ILIKE $${params.length}`
    }

    const { rows } = await pool.query(
      `SELECT il.*, pc.pancake_display_id, pc.product_title as pc_product_title
       FROM import_lot il
       LEFT JOIN product_cost pc ON pc.product_id = il.product_id
       ${where} ORDER BY il.lot_date DESC, il.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
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
  const body: Record<string, any> = (req.body && typeof req.body === "object") ? req.body as any : {}

  const product_id: string = body.product_id ?? ""
  const product_title: string = body.product_title ?? ""
  const lot_date: string = body.lot_date ?? ""
  const received_date: string | null = body.received_date ?? null
  const qty: number = Number(body.qty ?? 0)
  const price_unit: number = Number(body.price_unit ?? 0)
  const local_fee_tq: number = Number(body.local_fee_tq ?? 0)
  const ship_fee_ovs: number = Number(body.ship_fee_ovs ?? 0)
  const local_fee_vn: number = Number(body.local_fee_vn ?? 0)
  const vat_fee: number = Number(body.vat_fee ?? 0)
  const other_fee: number = Number(body.other_fee ?? 0)
  const source: string = body.source ?? "TQ"
  const status: string = body.status ?? "received"
  const note: string = body.note ?? ""

  if (!product_id || !product_title || !lot_date || !qty || !price_unit) {
    return res.status(400).json({ error: "Thiếu trường bắt buộc", received: { product_id, product_title, lot_date, qty, price_unit } })
  }

  const amount = Math.round(qty * price_unit * 100) / 100
  const final_price = calcFinalPrice({ qty, amount, local_fee_tq, ship_fee_ovs, local_fee_vn, vat_fee, other_fee })
  const created_by: string | null = (req as any).auth_context?.actor_id ?? null

  try {
    const pool = getPool()
    const { rows: [lot] } = await pool.query(
      `INSERT INTO import_lot
        (id, product_id, product_title, lot_date, received_date, qty, price_unit, amount,
         local_fee_tq, ship_fee_ovs, local_fee_vn, vat_fee, other_fee, final_price,
         source, status, note, created_by, created_at, updated_at)
       VALUES
        (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), now())
       RETURNING *`,
      [product_id, product_title, lot_date, received_date,
       qty, price_unit, amount, local_fee_tq, ship_fee_ovs,
       local_fee_vn, vat_fee, other_fee, final_price,
       source, status, note, created_by]
    )

    await pool.query(
      `INSERT INTO product_cost (id, product_id, product_title, avg_cost, stock_qty, total_lots, last_imported_at, updated_at)
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
         updated_at       = now()`,
      [product_id, product_title, final_price, qty, lot_date]
    )

    return res.json({ lot })
  } catch (err: any) {
    console.error("[gia-von POST error]", err?.message, err?.stack)
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
