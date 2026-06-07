import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureAgentForPage, getChatAuthInfo, getChatPool } from "../../../_lib"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const pool = getChatPool()
    const cur = await pool.query(`SELECT page_id, page_name FROM fb_bot_agent WHERE id = $1`, [id])
    if (!cur.rows[0]) return res.status(404).json({ error: "Agent not found" })
    const agent = await ensureAgentForPage(pool, cur.rows[0].page_id, cur.rows[0].page_name)
    return res.json({ ok: true, agent })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
