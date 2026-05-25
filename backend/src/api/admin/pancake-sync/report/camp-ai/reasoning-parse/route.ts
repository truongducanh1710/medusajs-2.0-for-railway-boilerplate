import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/pancake-sync/report/camp-ai/reasoning-parse
 * Body: { run_id: string }
 *
 * Parse messages từ agent_art_rollout thành structured steps lưu vào agent_reasoning_step.
 * Có thể chạy lại nhiều lần — dùng UNIQUE(run_id, step_idx) để upsert.
 */

function summarizeResult(text: string, maxLen = 300): string {
  if (!text) return ""
  const t = text.length > maxLen ? text.slice(0, maxLen) + "..." : text
  return t
}

function estimateTokens(s: string): number {
  return Math.ceil((s?.length ?? 0) / 4)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { run_id } = (req.body as any) ?? {}
    if (!run_id) return res.status(400).json({ error: "run_id required" })

    const sql = req.scope.resolve("cskhAnalysisModule") as any

    const rows = await sql.sql(
      `SELECT messages, tool_calls FROM agent_art_rollout WHERE run_id = $1`,
      [run_id]
    ).catch(() => [])

    if (!rows.length) return res.status(404).json({ error: "rollout not found" })

    const messages: any[] = Array.isArray(rows[0].messages) ? rows[0].messages : []
    let stepIdx = 0
    let parsed = 0

    // Xóa step cũ của run này để parse lại sạch
    await sql.sql(`DELETE FROM agent_reasoning_step WHERE run_id = $1`, [run_id]).catch(() => {})

    for (const m of messages) {
      if (m.role === "system") continue

      // Assistant text (thinking / decision)
      if (m.role === "assistant") {
        if (typeof m.content === "string" && m.content.trim().length > 0) {
          await sql.sql(
            `INSERT INTO agent_reasoning_step
               (run_id, step_idx, step_type, message_text, token_estimate)
             VALUES ($1, $2, 'thinking', $3, $4)
             ON CONFLICT (run_id, step_idx) DO UPDATE SET
               step_type=EXCLUDED.step_type, message_text=EXCLUDED.message_text,
               token_estimate=EXCLUDED.token_estimate`,
            [run_id, stepIdx++, m.content, estimateTokens(m.content)]
          ).catch(() => {})
          parsed++
        }

        // Tool calls
        if (Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            const fn = tc.function ?? {}
            let argsParsed: any = null
            try { argsParsed = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments } catch {}
            await sql.sql(
              `INSERT INTO agent_reasoning_step
                 (run_id, step_idx, step_type, tool_name, tool_args, token_estimate)
               VALUES ($1, $2, 'tool_call', $3, $4::jsonb, $5)
               ON CONFLICT (run_id, step_idx) DO UPDATE SET
                 step_type=EXCLUDED.step_type, tool_name=EXCLUDED.tool_name,
                 tool_args=EXCLUDED.tool_args, token_estimate=EXCLUDED.token_estimate`,
              [run_id, stepIdx++, fn.name ?? "unknown",
               JSON.stringify(argsParsed ?? {}),
               estimateTokens(typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}))]
            ).catch(() => {})
            parsed++
          }
        }
      }

      // Tool result
      if (m.role === "tool") {
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
        await sql.sql(
          `INSERT INTO agent_reasoning_step
             (run_id, step_idx, step_type, tool_name, tool_result_summary, tool_result_size, token_estimate)
           VALUES ($1, $2, 'tool_result', $3, $4, $5, $6)
           ON CONFLICT (run_id, step_idx) DO UPDATE SET
             step_type=EXCLUDED.step_type, tool_name=EXCLUDED.tool_name,
             tool_result_summary=EXCLUDED.tool_result_summary,
             tool_result_size=EXCLUDED.tool_result_size,
             token_estimate=EXCLUDED.token_estimate`,
          [run_id, stepIdx++, m.name ?? null, summarizeResult(text),
           text.length, estimateTokens(text)]
        ).catch(() => {})
        parsed++
      }
    }

    // Aggregate stats
    const stats = await sql.sql(`
      SELECT
        COUNT(*) AS total_steps,
        COUNT(*) FILTER (WHERE step_type = 'tool_call') AS tool_calls,
        COUNT(*) FILTER (WHERE step_type = 'thinking') AS thinking_steps,
        SUM(token_estimate) AS total_tokens,
        SUM(tool_result_size) FILTER (WHERE step_type = 'tool_result') AS total_result_bytes
      FROM agent_reasoning_step WHERE run_id = $1
    `, [run_id]).catch(() => [{}])

    return res.json({ ok: true, run_id, parsed, stats: stats[0] ?? {} })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}

/**
 * GET /admin/pancake-sync/report/camp-ai/reasoning-parse?run_id=...
 * Trả về structured steps đã parse
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const run_id = (req.query as any).run_id as string
    if (!run_id) return res.status(400).json({ error: "run_id required" })

    const sql = req.scope.resolve("cskhAnalysisModule") as any
    const steps = await sql.sql(
      `SELECT step_idx, step_type, tool_name, tool_args, tool_result_summary,
              tool_result_size, message_text, token_estimate, created_at
       FROM agent_reasoning_step
       WHERE run_id = $1
       ORDER BY step_idx ASC`,
      [run_id]
    ).catch(() => [])

    return res.json({ run_id, steps, total: steps.length })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
