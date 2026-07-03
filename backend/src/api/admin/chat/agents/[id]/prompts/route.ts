import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool } from "../../../_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const pool = getChatPool()
    await ensureChatTables(pool)

    const agent = await pool.query(`SELECT * FROM fb_bot_agent WHERE id = $1`, [id])
    if (!agent.rows[0]) return res.status(404).json({ error: "Agent not found" })
    if (auth.fbPageIds && !auth.fbPageIds.includes(agent.rows[0].page_id)) return res.status(403).json({ error: "Forbidden" })

    const versions = await pool.query(
      `SELECT * FROM fb_bot_prompt_version WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [id]
    )
    return res.json({ agent: agent.rows[0], versions: versions.rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
