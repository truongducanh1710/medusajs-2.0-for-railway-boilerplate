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
    const r = await client.query(query, params ?? [])
    return r.rows
  } finally {
    client.release()
  }
}

/**
 * GET /admin/ai-usage?days=7&feature=camp_ai_agent&limit=50&offset=0
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const days    = Math.min(90, Math.max(1, Number(req.query.days ?? 7)))
    const feature = (req.query.feature as string) || null
    const limit   = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)))
    const offset  = Math.max(0, Number(req.query.offset ?? 0))

    const featureClause = feature ? `AND feature = $2` : ""
    const params: any[] = [days]
    if (feature) params.push(feature)

    // Tổng hợp by feature
    const byFeature = await sql(
      `SELECT feature,
              COUNT(*)::int                          AS calls,
              SUM(total_tokens)::bigint              AS total_tokens,
              SUM(cost_usd)::numeric                 AS cost_usd
       FROM ai_usage_log
       WHERE created_at > now() - ($1 || ' days')::interval
       ${featureClause}
       GROUP BY feature
       ORDER BY cost_usd DESC`,
      params
    )

    // Tổng hợp by model
    const byModel = await sql(
      `SELECT model, provider,
              COUNT(*)::int                          AS calls,
              SUM(total_tokens)::bigint              AS total_tokens,
              SUM(cost_usd)::numeric                 AS cost_usd
       FROM ai_usage_log
       WHERE created_at > now() - ($1 || ' days')::interval
       ${featureClause}
       GROUP BY model, provider
       ORDER BY cost_usd DESC`,
      params
    )

    // Theo ngày (để vẽ chart)
    const byDay = await sql(
      `SELECT DATE(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
              SUM(cost_usd)::numeric                            AS cost_usd,
              SUM(total_tokens)::bigint                         AS total_tokens,
              COUNT(*)::int                                     AS calls
       FROM ai_usage_log
       WHERE created_at > now() - ($1 || ' days')::interval
       ${featureClause}
       GROUP BY 1
       ORDER BY 1 ASC`,
      params
    )

    // Grand total
    const totals = await sql(
      `SELECT COUNT(*)::int AS calls,
              SUM(total_tokens)::bigint AS total_tokens,
              SUM(cost_usd)::numeric AS cost_usd
       FROM ai_usage_log
       WHERE created_at > now() - ($1 || ' days')::interval
       ${featureClause}`,
      params
    )

    // Log rows
    const countRow = await sql(
      `SELECT COUNT(*)::int AS n FROM ai_usage_log
       WHERE created_at > now() - ($1 || ' days')::interval ${featureClause}`,
      params
    )

    const logParams = [...params, limit, offset]
    const logs = await sql(
      `SELECT id, feature, run_id, model, provider,
              prompt_tokens, completion_tokens, total_tokens,
              cost_usd, context, created_at
       FROM ai_usage_log
       WHERE created_at > now() - ($1 || ' days')::interval
       ${featureClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      logParams
    )

    return res.json({
      summary: {
        total_cost_usd:  totals[0]?.cost_usd  ?? 0,
        total_tokens:    totals[0]?.total_tokens ?? 0,
        total_calls:     totals[0]?.calls ?? 0,
        by_feature: byFeature,
        by_model:   byModel,
        by_day:     byDay,
      },
      logs,
      total: countRow[0]?.n ?? 0,
      limit,
      offset,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
