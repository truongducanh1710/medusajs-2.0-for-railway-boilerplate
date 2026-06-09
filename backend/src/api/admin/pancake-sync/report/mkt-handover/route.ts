import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

async function sql(query: string, params?: any[]): Promise<any[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(query, params ?? [])
    return result.rows
  } finally {
    client.release()
  }
}

async function ensureTable() {
  await sql(`
    CREATE TABLE IF NOT EXISTS mkt_handover (
      id          SERIAL PRIMARY KEY,
      from_code   TEXT NOT NULL,
      to_code     TEXT NOT NULL,
      effective_from DATE NOT NULL,
      note        TEXT DEFAULT '',
      created_at  TIMESTAMPTZ DEFAULT now(),
      deleted_at  TIMESTAMPTZ
    )
  `)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    await ensureTable()
    const rows = await sql(
      `SELECT id, from_code, to_code, effective_from, note, created_at
       FROM mkt_handover WHERE deleted_at IS NULL ORDER BY effective_from DESC`
    )
    return res.json({ rules: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from_code, to_code, effective_from, note = "" } = req.body as any
    if (!from_code || !to_code || !effective_from) {
      return res.status(400).json({ error: "Thiếu from_code, to_code hoặc effective_from" })
    }
    await ensureTable()
    const [row] = await sql(
      `INSERT INTO mkt_handover (from_code, to_code, effective_from, note)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [from_code.toUpperCase(), to_code.toUpperCase(), effective_from, note]
    )
    return res.json({ rule: row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
