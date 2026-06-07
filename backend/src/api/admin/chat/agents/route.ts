import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureAgentForPage, ensureChatTables, getChatAuthInfo, getChatPool } from "../_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const pool = getChatPool()
    await ensureChatTables(pool)
    const { rows } = await pool.query(
      `SELECT a.*, pt.fan_count, mp.sp_chay, mp.mkt_code, mp.hoat_dong
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
