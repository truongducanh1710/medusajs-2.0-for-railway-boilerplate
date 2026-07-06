import { Pool } from "pg"
import { MYR_TO_VND_RATE } from "./constants"

let _pool: Pool | null = null

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  }
  return _pool
}

/**
 * Tỷ giá MYR→VND theo tháng (bảng mkt_exchange_rate, quản lý qua /admin/exchange-rate).
 * Chưa có bản ghi tháng đó → dùng tháng gần nhất trước đó → cuối cùng fallback ENV.
 */
export async function getMyrToVndRate(dateStr: string): Promise<number> {
  const month = dateStr.slice(0, 7)
  const pool = getPool()
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mkt_exchange_rate (
        month TEXT PRIMARY KEY,
        myr_to_vnd NUMERIC NOT NULL,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    const { rows } = await pool.query(
      `SELECT myr_to_vnd FROM mkt_exchange_rate WHERE month <= $1 ORDER BY month DESC LIMIT 1`,
      [month]
    )
    if (rows[0]) return Number(rows[0].myr_to_vnd)
  } catch {
    // bảng lỗi/chưa sẵn sàng — fallback ENV bên dưới
  }
  return MYR_TO_VND_RATE
}
