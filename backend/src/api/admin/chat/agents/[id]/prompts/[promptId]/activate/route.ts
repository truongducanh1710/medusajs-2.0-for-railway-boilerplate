import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool } from "../../../../../_lib"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const { id, promptId } = req.params as any
    const pool = getChatPool()
    await ensureChatTables(pool)

    const cur = await pool.query(
      `SELECT pv.*, a.page_id
       FROM fb_bot_prompt_version pv
       JOIN fb_bot_agent a ON a.id = pv.agent_id
       WHERE pv.id = $1 AND pv.agent_id = $2`,
      [promptId, id]
    )
    const version = cur.rows[0]
    if (!version) return res.status(404).json({ error: "Prompt version not found" })
    if (auth.fbPageIds && !auth.fbPageIds.includes(version.page_id)) return res.status(403).json({ error: "Forbidden" })

    await pool.query(`UPDATE fb_bot_prompt_version SET status = CASE WHEN id = $1 THEN 'active' ELSE CASE WHEN status = 'active' THEN 'approved' ELSE status END END WHERE agent_id = $2`, [promptId, id])
    await pool.query(
      `UPDATE fb_bot_prompt_version
       SET approved_by = $2, approved_at = COALESCE(approved_at, now()), activated_at = now(), status = 'active'
       WHERE id = $1`,
      [promptId, auth.email || "admin"]
    )
    const updated = await pool.query(
      `UPDATE fb_bot_agent
       SET manual_override_instruction = $1,
           active_prompt_version_id = $2,
           prompt_score = $3,
           last_eval_at = now(),
           updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [version.prompt_text, promptId, version.score_after ?? version.score_before ?? null, id]
    )
    return res.json({ ok: true, agent: updated.rows[0], version: { ...version, status: "active" } })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
