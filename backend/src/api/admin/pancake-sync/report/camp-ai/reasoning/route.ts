import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/camp-ai/reasoning
 * Query: run_id (required), campaign_id (optional filter)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { run_id, campaign_id } = req.query as Record<string, string>
    if (!run_id) return res.status(400).json({ error: "run_id là bắt buộc" })

    const sql = req.scope.resolve("cskhAnalysisModule") as any

    const rollout = await sql.sql(
      `SELECT messages, tool_calls FROM agent_art_rollout WHERE run_id = $1`,
      [run_id]
    ).catch(() => [])

    if (!rollout.length) return res.json({ trace: [], tool_calls: [] })

    let messages: any[] = rollout[0].messages ?? []

    // Filter messages relevant to campaign_id when provided
    if (campaign_id) {
      messages = messages.filter((m: any) => {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
        const hasId = content.includes(campaign_id)
        const hasTool = m.tool_calls?.some((tc: any) => (tc.function?.arguments ?? "").includes(campaign_id))
        return hasId || hasTool
      })
    }

    // Get reflection info for recs in this run
    const recInfo = await sql.sql(
      `SELECT id, campaign_id, campaign_name, action, reason, reflection_passed, reflection_notes, evaluator_model, validation_retries
       FROM agent_camp_recommendation WHERE run_id = $1 ORDER BY created_at`,
      [run_id]
    ).catch(() => [])

    return res.json({
      trace: messages,
      tool_calls: rollout[0].tool_calls ?? [],
      recommendations: recInfo,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
