import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/gia-von/cpqc?product_code=PHVVN031_BCX
 * Lịch sử các lần lưu tính CPQC (mới nhất trước). Không truyền product_code → 20 bản ghi gần nhất toàn hệ thống.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { product_code } = req.query as Record<string, string>
    const pool = getPool()
    const rows = product_code
      ? (await pool.query(
          `SELECT * FROM cpqc_target WHERE product_code = $1 ORDER BY created_at DESC LIMIT 50`,
          [product_code.trim().toUpperCase()]
        )).rows
      : (await pool.query(`SELECT * FROM cpqc_target ORDER BY created_at DESC LIMIT 20`)).rows
    return res.json({ rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/gia-von/cpqc
 * Lưu 1 bản ghi tính CPQC mới (append-only, giữ lịch sử).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const b: Record<string, any> = (req.body && typeof req.body === "object") ? req.body as any : {}

  const product_name: string = (b.product_name ?? "").trim()
  if (!product_name) {
    return res.status(400).json({ error: "Thiếu product_name" })
  }
  const product_code: string | null = b.product_code ? String(b.product_code).trim().toUpperCase() : null
  const created_by: string | null = (req as any).auth_context?.actor_id ?? null

  try {
    const pool = getPool()
    const { rows: [row] } = await pool.query(
      `INSERT INTO cpqc_target
        (id, product_code, product_name, from_date, to_date, avg_selling_price,
         cost_don1, cost_don2, cost_don3, pct_don1, pct_don2, pct_don3, return_rate,
         ship_fee, cod_fee_pct, packing_fee, target_margin_pct, exchange_rate, created_by, created_at)
       VALUES
        (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
       RETURNING *`,
      [
        product_code, product_name,
        b.from_date ?? null, b.to_date ?? null,
        Number(b.avg_selling_price ?? 0),
        Number(b.cost_don1 ?? 0), Number(b.cost_don2 ?? 0), Number(b.cost_don3 ?? 0),
        Number(b.pct_don1 ?? 0), Number(b.pct_don2 ?? 0), Number(b.pct_don3 ?? 0),
        Number(b.return_rate ?? 0),
        Number(b.ship_fee ?? 0), Number(b.cod_fee_pct ?? 0), Number(b.packing_fee ?? 0),
        Number(b.target_margin_pct ?? 0), Number(b.exchange_rate ?? 24000),
        created_by,
      ]
    )
    return res.json({ row })
  } catch (err: any) {
    console.error("[gia-von/cpqc POST]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
