import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureAgentForPage, ensureChatTables, getChatAuthInfo, getChatPool } from "../_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const pool = getChatPool()
    await ensureChatTables(pool)
    const { rows } = await pool.query(
      `SELECT a.*, pt.fan_count, mp.sp_chay, mp.mkt_code, mp.hoat_dong,
        (
          SELECT jsonb_build_object(
            'id', pv.id,
            'version', pv.version,
            'status', pv.status,
            'score_before', pv.score_before,
            'score_after', pv.score_after,
            'eval_summary', pv.eval_summary,
            'change_reason', pv.change_reason,
            'prompt_text', pv.prompt_text,
            'created_at', pv.created_at
          )
          FROM fb_bot_prompt_version pv
          WHERE pv.agent_id = a.id
          ORDER BY pv.created_at DESC
          LIMIT 1
        ) AS latest_prompt_version
       FROM fb_bot_agent a
       LEFT JOIN fb_page_token pt ON pt.page_id = a.page_id
       LEFT JOIN mkt_page mp ON lower(trim(mp.page_name)) = lower(trim(a.page_name))
       ORDER BY a.updated_at DESC`
    )
    return res.json({ agents: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const pool = getChatPool()
    await ensureChatTables(pool)
    const pages = await pool.query(`SELECT page_id, page_name FROM fb_page_token ORDER BY page_name`)
    const agents = []
    for (const p of pages.rows) {
      if (auth.fbPageIds && !auth.fbPageIds.includes(p.page_id)) continue
      agents.push(await ensureAgentForPage(pool, p.page_id, p.page_name))
    }
    return res.json({ ok: true, generated: agents.length, agents })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
