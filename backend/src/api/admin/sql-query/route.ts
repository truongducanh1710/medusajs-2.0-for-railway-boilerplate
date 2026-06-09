import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

const BLOCKED = /^\s*(drop|truncate|delete|update|insert|alter|create|grant|revoke|pg_read|pg_write|copy)\b/i

/**
 * POST /admin/sql-query
 * Body: { sql: string, params?: any[] }
 * Chỉ cho phép SELECT — block mọi DML/DDL.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { sql: query, params = [] } = req.body as { sql: string; params?: any[] }

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Missing sql" })
    }

    const trimmed = query.trim()
    if (BLOCKED.test(trimmed)) {
      return res.status(403).json({ error: "Chỉ cho phép SELECT query" })
    }
    if (!/^\s*select\b/i.test(trimmed)) {
      return res.status(403).json({ error: "Chỉ cho phép SELECT query" })
    }

    const client = await getPool().connect()
    try {
      const result = await client.query(query, params)
      return res.json({ rows: result.rows, rowCount: result.rowCount })
    } finally {
      client.release()
    }
  } catch (err: any) {
    console.error("[sql-query]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
