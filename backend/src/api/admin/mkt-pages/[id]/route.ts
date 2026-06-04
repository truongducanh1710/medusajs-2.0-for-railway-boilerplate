import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const id = (req.params as any).id
    const b = req.body as any
    const pool = getPool()

    const fields = ["mkt_code","page_name","page_link","sp_chay","pancake","hoat_dong","share_anhtd","pos","bm","share_hoan","ghi_chu"]
    const sets: string[] = []
    const params: any[] = []

    for (const f of fields) {
      if (b[f] !== undefined) {
        params.push(f === "mkt_code" ? (b[f] || "").toUpperCase() : b[f])
        sets.push(`${f} = $${params.length}`)
      }
    }
    if (!sets.length) return res.status(400).json({ error: "Không có trường nào" })
    sets.push(`updated_at = now()`)
    params.push(id)

    await pool.query(`UPDATE mkt_page SET ${sets.join(", ")} WHERE id = $${params.length}`, params)
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const id = (req.params as any).id
    const pool = getPool()
    await pool.query(`DELETE FROM mkt_page WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
