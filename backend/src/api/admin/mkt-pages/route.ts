import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

async function ensureTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mkt_page (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mkt_code     VARCHAR(32) NOT NULL,
      page_name    VARCHAR(255) NOT NULL,
      page_link    TEXT,
      sp_chay      TEXT,
      pancake      VARCHAR(32) DEFAULT 'CHƯA',
      hoat_dong    VARCHAR(32) DEFAULT 'ĐANG CHẠY',
      share_anhtd  VARCHAR(32) DEFAULT 'CHƯA',
      pos          VARCHAR(32) DEFAULT 'CHƯA',
      bm           VARCHAR(32) DEFAULT 'CHƯA',
      share_hoan   VARCHAR(32) DEFAULT 'CHƯA',
      ghi_chu      TEXT,
      created_at   TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mkt_page_mkt ON mkt_page (mkt_code)`)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await ensureTable(pool)
    const { rows } = await pool.query(
      `SELECT * FROM mkt_page ORDER BY mkt_code, created_at ASC`
    )
    return res.json({ pages: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await ensureTable(pool)
    const b = req.body as any
    const { rows: [row] } = await pool.query(
      `INSERT INTO mkt_page (mkt_code, page_name, page_link, sp_chay, pancake, hoat_dong, share_anhtd, pos, bm, share_hoan, ghi_chu)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        (b.mkt_code || "").toUpperCase(),
        b.page_name || "",
        b.page_link || "",
        b.sp_chay || "",
        b.pancake || "CHƯA",
        b.hoat_dong || "ĐANG CHẠY",
        b.share_anhtd || "CHƯA",
        b.pos || "CHƯA",
        b.bm || "CHƯA",
        b.share_hoan || "CHƯA",
        b.ghi_chu || "",
      ]
    )
    return res.json({ page: row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
