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

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const { effective_to } = req.body as any
    const [row] = await sql(
      `UPDATE mkt_handover SET effective_to = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
      [effective_to || null, id]
    )
    return res.json({ rule: row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    await sql(`UPDATE mkt_handover SET deleted_at = now() WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
