import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/exchange-rate/list
 * Toàn bộ lịch sử tỷ giá MYR→VND theo tháng, mới nhất trước — dùng cho trang cài đặt.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mkt_exchange_rate (
        month TEXT PRIMARY KEY,
        myr_to_vnd NUMERIC NOT NULL,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    const { rows } = await pool.query(`SELECT * FROM mkt_exchange_rate ORDER BY month DESC`)
    return res.json({ rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
