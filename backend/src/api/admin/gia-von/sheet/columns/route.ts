import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * POST /admin/gia-von/sheet/columns
 * Thêm cột mới
 * Body: { name: string, col_type?: "text"|"number", width?: number }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body: any = req.body ?? {}
    const name: string = (body.name ?? "").trim()
    if (!name) return res.status(400).json({ error: "Thiếu tên cột" })
    const col_type = body.col_type === "number" ? "number" : "text"
    const width = Math.max(60, Math.min(Number(body.width ?? 120), 500))

    const pool = getPool()
    const { rows: [{ maxpos }] } = await pool.query(
      `SELECT COALESCE(MAX(position), -1) as maxpos FROM cost_sheet_column`
    )
    const position = Number(maxpos) + 1

    const { rows: [col] } = await pool.query(
      `INSERT INTO cost_sheet_column (id, position, name, col_type, width)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       RETURNING id, position, name, col_type, width`,
      [position, name, col_type, width]
    )
    return res.json({ column: col })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
