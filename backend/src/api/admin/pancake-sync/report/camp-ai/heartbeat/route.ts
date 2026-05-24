import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/camp-ai/heartbeat
 * Trả về các run đang active (chưa done/error) hoặc done trong 2 phút gần nhất
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const sql = req.scope.resolve("cskhAnalysisModule") as any
    const rows = await sql.sql(`
      SELECT run_id, model, mkt, phase, iteration, last_action,
             recs_so_far, tokens_used, error,
             started_at, updated_at,
             EXTRACT(EPOCH FROM (now() - updated_at))::int as stale_seconds,
             EXTRACT(EPOCH FROM (now() - started_at))::int as runtime_seconds
      FROM agent_heartbeat
      WHERE updated_at > now() - interval '10 minutes'
      ORDER BY updated_at DESC
      LIMIT 20
    `).catch(() => [])
    return res.json({ heartbeats: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
