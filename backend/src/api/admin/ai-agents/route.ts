import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

// Bảng ai_agent sống trong CÙNG Postgres (DATABASE_URL) nhưng được tạo/đọc bởi
// phanviet-agent-mcp (migrations/003_multi_agent.sql, agent/agents.mjs), không phải
// Medusa module — không có model Medusa cho bảng này. Route này chỉ ĐỌC, theo đúng
// pattern ai-usage/route.ts (pool riêng, không qua module resolve).
let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

async function sql(query: string, params?: any[]): Promise<any[]> {
  const client = await getPool().connect()
  try {
    const r = await client.query(query, params ?? [])
    return r.rows
  } finally {
    client.release()
  }
}

/**
 * GET /admin/ai-agents
 * Danh sách agent (bảng ai_agent) cho canvas sơ đồ quan hệ trong /app/ai-settings.
 * Không trả password/credential — chỉ cấu hình công khai của mỗi agent.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const agents = await sql(
      `SELECT id, handle, display_name, avatar, medusa_email, tool_groups,
              is_generalist, enabled, created_at, updated_at
       FROM ai_agent
       ORDER BY is_generalist DESC, created_at ASC`
    )
    return res.json({ agents })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
