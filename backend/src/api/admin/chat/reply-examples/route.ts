import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool } from "../_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const pool = getChatPool()
    await ensureChatTables(pool)
    const status = String((req.query as any).status || "pending")
    const { rows } = await pool.query(
      `SELECT * FROM fb_bot_reply_example
       WHERE ($1 = 'all' OR review_status = $1)
       ORDER BY created_at DESC LIMIT 200`,
      [status]
    )
    return res.json({ examples: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
