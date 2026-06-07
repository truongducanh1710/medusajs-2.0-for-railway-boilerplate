import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getChatAuthInfo, getChatPool, logConversationEvent } from "../../../_lib"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const pool = getChatPool()
    await pool.query(
      `UPDATE fb_conversation SET assigned_to = $2, status = 'assigned', bot_paused = true, assigned_at = now(), updated_at = now() WHERE id = $1`,
      [id, auth.email]
    ).catch(async (e: any) => {
      if (String(e.message).includes("assigned_at")) {
        await pool.query(`ALTER TABLE fb_conversation ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`)
        await pool.query(`UPDATE fb_conversation SET assigned_to = $2, status = 'assigned', bot_paused = true, assigned_at = now(), updated_at = now() WHERE id = $1`, [id, auth.email])
      } else throw e
    })
    await logConversationEvent(pool, id, "conversation_assigned", "sale", auth.email, {})
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
