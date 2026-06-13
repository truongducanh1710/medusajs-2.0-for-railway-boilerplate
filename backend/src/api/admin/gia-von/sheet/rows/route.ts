import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * POST /admin/gia-von/sheet/rows
 * Thêm 1 hoặc nhiều dòng mới
 * Body: { count?: number } — thêm N dòng trống
 *    hoặc { rows: [{ data: {...} }] } — thêm dòng với data sẵn (paste)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body: any = req.body ?? {}
    const pool = getPool()

    const { rows: [{ maxpos }] } = await pool.query(
      `SELECT COALESCE(MAX(position), -1) as maxpos FROM cost_sheet_row`
    )
    let nextPos = Number(maxpos) + 1

    let toInsert: { data: Record<string, string> }[] = []
    if (Array.isArray(body.rows)) {
      toInsert = body.rows.map((r: any) => ({ data: r.data ?? {} }))
    } else {
      const count = Math.max(1, Math.min(Number(body.count ?? 1), 200))
      toInsert = Array.from({ length: count }, () => ({ data: {} }))
    }

    const inserted: any[] = []
    for (const r of toInsert) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO cost_sheet_row (id, position, data, updated_at)
         VALUES (gen_random_uuid(), $1, $2, now()) RETURNING id, position, data`,
        [nextPos, JSON.stringify(r.data)]
      )
      inserted.push(row)
      nextPos++
    }

    return res.json({ rows: inserted })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * PUT /admin/gia-von/sheet/rows
 * Bulk update cells: { rows: [{ id, data }] }
 * data là toàn bộ JSONB của dòng đó (frontend gửi full data sau mỗi edit)
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body: any = req.body ?? {}
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return res.json({ updated: 0 })
    }
    const pool = getPool()
    let updated = 0
    for (const r of body.rows) {
      if (!r.id) continue
      await pool.query(
        `UPDATE cost_sheet_row SET data = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(r.data ?? {}), r.id]
      )
      updated++
    }
    return res.json({ updated })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
