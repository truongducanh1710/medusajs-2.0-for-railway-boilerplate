import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/camp-ai/evaluation
 *
 * Query params:
 * - view=agent_vs_marketer | run_summary | rec_detail | error_tags
 * - run_id, rec_id, mkt, days (default 7)
 *
 * Trả về các metric đánh giá agent.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string>
    const view = q.view ?? "run_summary"
    const days = Math.min(parseInt(q.days ?? "7") || 7, 30)
    const sql = req.scope.resolve("cskhAnalysisModule") as any

    // VIEW 1: Agreement giữa agent recommend vs marketer thật
    if (view === "agent_vs_marketer") {
      const rows = await sql.sql(`
        SELECT
          agent_model, agreement, COUNT(*) AS n
        FROM v_agent_vs_marketer
        WHERE rec_at > now() - interval '${days} days'
          ${q.mkt ? `AND mkt_name = $1` : ""}
        GROUP BY agent_model, agreement
        ORDER BY agent_model, agreement
      `, q.mkt ? [q.mkt] : []).catch(() => [])

      const detail = await sql.sql(`
        SELECT rec_id, run_id, campaign_id, campaign_name, mkt_name,
               agent_action, marketer_action, agreement, confidence,
               agent_model, rec_at, marketer_action_at
        FROM v_agent_vs_marketer
        WHERE rec_at > now() - interval '${days} days'
          ${q.mkt ? `AND mkt_name = $1` : ""}
        ORDER BY rec_at DESC
        LIMIT 200
      `, q.mkt ? [q.mkt] : []).catch(() => [])

      return res.json({ summary: rows, detail })
    }

    // VIEW 2: Per-rec evaluation — before/after metrics + agreement + error tags
    if (view === "rec_detail" && q.rec_id) {
      const rec = await sql.sql(
        `SELECT r.*, vm.agreement, vm.marketer_action, vm.marketer_action_at
         FROM agent_camp_recommendation r
         LEFT JOIN v_agent_vs_marketer vm ON vm.rec_id = r.id
         WHERE r.id = $1`,
        [q.rec_id]
      ).catch(() => [])

      const snapshots = await sql.sql(
        `SELECT snapshot_type, spend, impressions, clicks, cod_orders, cod_amount,
                care_pct, cpm, ctr_pct, effective_status, daily_budget,
                shop_care_pct, shop_cod, snapshot_at
         FROM agent_decision_snapshot
         WHERE rec_id = $1 ORDER BY snapshot_at`,
        [q.rec_id]
      ).catch(() => [])

      const tags = await sql.sql(
        `SELECT id, layer, category, severity, note, tagged_by, created_at
         FROM agent_error_tag
         WHERE target_type = 'rec' AND target_id = $1
         ORDER BY created_at DESC`,
        [q.rec_id]
      ).catch(() => [])

      return res.json({ rec: rec[0] ?? null, snapshots, tags })
    }

    // VIEW 3: Run summary — tổng hợp 1 run
    if (view === "run_summary" && q.run_id) {
      const steps = await sql.sql(`
        SELECT step_type, COUNT(*) AS n, SUM(token_estimate) AS tokens,
               SUM(tool_result_size) AS bytes
        FROM agent_reasoning_step WHERE run_id = $1
        GROUP BY step_type
      `, [q.run_id]).catch(() => [])

      const toolStats = await sql.sql(`
        SELECT tool_name, COUNT(*) AS n, SUM(token_estimate) AS tokens
        FROM agent_reasoning_step
        WHERE run_id = $1 AND tool_name IS NOT NULL
        GROUP BY tool_name ORDER BY n DESC
      `, [q.run_id]).catch(() => [])

      const recs = await sql.sql(`
        SELECT r.id, r.campaign_name, r.mkt_name, r.action, r.confidence, r.status,
               vm.agreement, vm.marketer_action,
               (SELECT COUNT(*) FROM agent_error_tag t
                WHERE t.target_type='rec' AND t.target_id=r.id) AS error_tag_count,
               (SELECT COUNT(*) FROM agent_decision_snapshot s
                WHERE s.rec_id=r.id) AS snapshot_count
        FROM agent_camp_recommendation r
        LEFT JOIN v_agent_vs_marketer vm ON vm.rec_id = r.id
        WHERE r.run_id = $1
        ORDER BY r.created_at
      `, [q.run_id]).catch(() => [])

      const runTags = await sql.sql(
        `SELECT * FROM agent_error_tag WHERE target_type='run' AND target_id=$1 ORDER BY created_at DESC`,
        [q.run_id]
      ).catch(() => [])

      return res.json({ steps, tool_stats: toolStats, recs, run_tags: runTags })
    }

    // VIEW 4: Error tags overview — distribution theo layer/category
    if (view === "error_tags") {
      const rows = await sql.sql(`
        SELECT layer, category, severity, COUNT(*) AS n
        FROM agent_error_tag
        WHERE created_at > now() - interval '${days} days'
        GROUP BY layer, category, severity
        ORDER BY n DESC
      `).catch(() => [])

      return res.json({ summary: rows })
    }

    return res.status(400).json({ error: "Unknown view" })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}

/**
 * POST /admin/pancake-sync/report/camp-ai/evaluation
 * Body: { target_type, target_id, layer, category, severity?, note? }
 * Thêm 1 error tag cho rec hoặc run.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const b = (req.body as any) ?? {}
    if (!b.target_type || !b.target_id || !b.layer || !b.category) {
      return res.status(400).json({ error: "target_type, target_id, layer, category required" })
    }
    const sql = req.scope.resolve("cskhAnalysisModule") as any
    const user = (req as any).auth_context?.actor_id || (req as any).user?.email || "unknown"

    const ins = await sql.sql(
      `INSERT INTO agent_error_tag (target_type, target_id, layer, category, severity, note, tagged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [b.target_type, b.target_id, b.layer, b.category, b.severity ?? "medium", b.note ?? null, user]
    )

    return res.json({ ok: true, id: ins[0]?.id, created_at: ins[0]?.created_at })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}

/**
 * DELETE /admin/pancake-sync/report/camp-ai/evaluation?id=...
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const id = (req.query as any).id as string
    if (!id) return res.status(400).json({ error: "id required" })
    const sql = req.scope.resolve("cskhAnalysisModule") as any
    await sql.sql(`DELETE FROM agent_error_tag WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
