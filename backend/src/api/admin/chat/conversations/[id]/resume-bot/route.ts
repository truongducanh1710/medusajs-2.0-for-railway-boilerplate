import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getChatAuthInfo, getChatPool, logConversationEvent } from "../../../_lib"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const pool = getChatPool()
    await pool.query(`UPDATE fb_conversation SET bot_paused = false, bot_paused_reason = null, status = 'bot_handling', updated_at = now() WHERE id = $1`, [id])
    await logConversationEvent(pool, id, "bot_resumed", "sale", auth.email, {})
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
