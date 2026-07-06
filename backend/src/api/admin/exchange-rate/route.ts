import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { MYR_TO_VND_RATE } from "../../../lib/constants"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

async function ensureTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mkt_exchange_rate (
      month TEXT PRIMARY KEY,
      myr_to_vnd NUMERIC NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/**
 * GET /admin/exchange-rate?month=2026-07
 * Không truyền month → tỷ giá tháng hiện tại.
 * Nếu tháng đó chưa có bản ghi → fallback tỷ giá tháng gần nhất trước đó, rồi tới ENV mặc định.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await ensureTable(pool)
    const month = (req.query.month as string) || currentMonth()

    const exact = await pool.query(`SELECT * FROM mkt_exchange_rate WHERE month = $1`, [month])
    if (exact.rows[0]) {
      return res.json({ month, rate: Number(exact.rows[0].myr_to_vnd), source: "month", row: exact.rows[0] })
    }

    const latest = await pool.query(
      `SELECT * FROM mkt_exchange_rate WHERE month <= $1 ORDER BY month DESC LIMIT 1`,
      [month]
    )
    if (latest.rows[0]) {
      return res.json({ month, rate: Number(latest.rows[0].myr_to_vnd), source: "fallback_previous_month", row: latest.rows[0] })
    }

    return res.json({ month, rate: MYR_TO_VND_RATE, source: "env_default" })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * GET (list) dùng chung route qua query ?list=1 để lấy toàn bộ lịch sử cho trang cài đặt.
 * PUT /admin/exchange-rate
 * Body: { month: "2026-07", rate: 6000 }
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const b = (req.body ?? {}) as { month?: string; rate?: number }
    const month = (b.month || "").trim()
    const rate = Number(b.rate)
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month phải theo định dạng YYYY-MM" })
    if (!rate || rate <= 0) return res.status(400).json({ error: "rate phải > 0" })

    const actor = (req as any).auth_context?.actor_id ?? null
    const pool = getPool()
    await ensureTable(pool)
    const { rows: [row] } = await pool.query(
      `INSERT INTO mkt_exchange_rate (month, myr_to_vnd, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (month) DO UPDATE SET
         myr_to_vnd = EXCLUDED.myr_to_vnd,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [month, rate, actor]
    )
    return res.json({ ok: true, row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
