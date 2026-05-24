import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import campAiCare from "../../../../../jobs/camp-ai-care"

/**
 * GET /admin/pancake-sync/report/camp-ai
 * Query: status, mkt, run_id, limit, offset
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { status, mkt, run_id, limit = "50", offset = "0" } = req.query as Record<string, string>
    const lim = Math.min(parseInt(limit) || 50, 200)
    const off = Math.max(parseInt(offset) || 0, 0)
    const sql = req.scope.resolve("cskhAnalysisModule") as any

    const conds: string[] = []
    const params: any[] = []
    if (status) { params.push(status); conds.push(`r.status = $${params.length}`) }
    if (mkt) { params.push(mkt); conds.push(`r.mkt_name = $${params.length}`) }
    if (run_id) { params.push(run_id); conds.push(`r.run_id = $${params.length}`) }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : ""

    params.push(lim, off)
    const recs = await sql.sql(
      `SELECT r.id, r.run_id, r.campaign_id, r.campaign_name, r.mkt_name, r.action, r.reason,
              r.old_value, r.suggested_value, r.confidence, r.status,
              r.approved_by, r.approved_at, r.executed_at, r.agent_model, r.created_at
       FROM agent_camp_recommendation r
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ).catch(() => [])

    const totalRows = await sql.sql(
      `SELECT COUNT(*)::int as total FROM agent_camp_recommendation r ${where}`,
      params.slice(0, -2)
    ).catch(() => [{ total: 0 }])

    // Summary: group by run_id
    const runSummary = await sql.sql(`
      SELECT run_id, MIN(created_at) AS created_at, agent_model,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE action != 'no_action') AS actionable,
             COUNT(*) FILTER (WHERE status = 'pending') AS pending,
             COUNT(*) FILTER (WHERE status = 'approved') AS approved,
             COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
             COUNT(*) FILTER (WHERE status = 'auto_executed') AS auto_executed
      FROM agent_camp_recommendation
      WHERE created_at >= CURRENT_DATE - 7
      GROUP BY run_id, agent_model
      ORDER BY created_at DESC
      LIMIT 20
    `).catch(() => [])

    return res.json({ recommendations: recs, total: totalRows[0]?.total ?? 0, run_summary: runSummary })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/pancake-sync/report/camp-ai
 * Body: { mkt?: string, model?: string, parallel?: boolean } — manual trigger
 * parallel=true fires 1 agent per active MKT concurrently (no mkt filter needed)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { mkt, model, parallel } = (req.body as any) || {}
    const container = (req as any).scope
    const modelLabel = model ? ` [${model}]` : ""

    if (parallel && !mkt) {
      const sql = req.scope.resolve("cskhAnalysisModule") as any
      const mkts = await sql.sql(`
        SELECT DISTINCT mkt_name FROM mkt_ads_cost
        WHERE date >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 14
          AND deleted_at IS NULL AND spend > 0
        ORDER BY mkt_name
      `).catch(() => [])

      for (const m of mkts) {
        campAiCare(container, { mkt: m.mkt_name, model }).catch((e: any) =>
          console.error(`[CampAI parallel] MKT=${m.mkt_name} error:`, e.message)
        )
      }
      return res.json({ ok: true, message: `Đang chạy ${mkts.length} agents song song${modelLabel}`, mkts: mkts.map((m: any) => m.mkt_name) })
    }

    campAiCare(container, { mkt, model }).catch((e: any) =>
      console.error("[CampAI manual] Error:", e.message)
    )

    return res.json({ ok: true, message: `Agent đang chạy${modelLabel}, kiểm tra lại sau 30-60 giây` })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
