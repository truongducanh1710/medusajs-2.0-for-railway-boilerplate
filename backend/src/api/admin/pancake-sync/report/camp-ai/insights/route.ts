import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/camp-ai/insights
 * Query: category, mkt, limit=50
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { category, mkt, limit = "50" } = req.query as Record<string, string>
    const lim = Math.min(parseInt(limit) || 50, 200)
    const sql = req.scope.resolve("cskhAnalysisModule") as any

    const conds: string[] = ["active = true"]
    const params: any[] = []
    if (category) { params.push(category); conds.push(`category = $${params.length}`) }
    if (mkt) { params.push(mkt); conds.push(`scope->>'mkt' = $${params.length}`) }

    params.push(lim)
    const insights = await sql.sql(
      `SELECT id, category, scope, insight, evidence, applied_count, outcome_score, agent_model, created_at, last_used_at
       FROM agent_insight
       WHERE ${conds.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    ).catch(() => [])

    // Stats theo category + model
    const stats = await sql.sql(`
      SELECT category, agent_model, COUNT(*)::int as count
      FROM agent_insight WHERE active = true
      GROUP BY category, agent_model
      ORDER BY count DESC
    `).catch(() => [])

    return res.json({ insights, stats })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * DELETE /admin/pancake-sync/report/camp-ai/insights?id=<uuid>
 * Soft delete (set active = false)
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.query as Record<string, string>
    if (!id) return res.status(400).json({ error: "id required" })
    const sql = req.scope.resolve("cskhAnalysisModule") as any
    await sql.sql(`UPDATE agent_insight SET active = false WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
