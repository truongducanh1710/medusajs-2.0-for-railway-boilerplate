import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getChatAuthInfo, getChatPool } from "../../../_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const pool = getChatPool()
    const { rows } = await pool.query(
      `SELECT * FROM fb_bot_event_log WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [id]
    )
    return res.json({ events: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
