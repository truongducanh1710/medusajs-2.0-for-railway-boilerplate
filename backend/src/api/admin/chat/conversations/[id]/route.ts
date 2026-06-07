import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool, refreshConversationContext } from "../../_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const pool = getChatPool()
    await ensureChatTables(pool)
    await refreshConversationContext(pool, id)

    const conv = await pool.query(
      `SELECT c.*, ctx.*, a.mode AS bot_mode, a.product_names, a.generated_instruction, a.manual_override_instruction
       FROM fb_conversation c
       LEFT JOIN fb_conversation_context ctx ON ctx.conversation_id = c.id
       LEFT JOIN fb_bot_agent a ON a.page_id = c.page_id
       WHERE c.id = $1`,
      [id]
    )
    if (!conv.rows[0]) return res.status(404).json({ error: "Conversation not found" })
    const c = conv.rows[0]
    if (auth.fbPageIds && !auth.fbPageIds.includes(c.page_id)) return res.status(403).json({ error: "Forbidden" })

    const messages = await pool.query(
      `SELECT * FROM fb_message WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 300`,
      [id]
    )
    const events = await pool.query(
      `SELECT * FROM fb_conversation_event WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [id]
    )
    const orders = await pool.query(
      `SELECT * FROM fb_chat_order_link WHERE conversation_id = $1 ORDER BY created_at DESC`,
      [id]
    )
    await pool.query(`UPDATE fb_conversation SET unread_count = 0 WHERE id = $1`, [id])
    return res.json({ conversation: c, messages: messages.rows, events: events.rows, orders: orders.rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const b = req.body as any
    const fields = ["status", "tags", "bot_paused", "bot_paused_reason", "active_product_interest", "priority"]
    const sets: string[] = []
    const vals: any[] = []
    for (const f of fields) {
      if (b[f] !== undefined) {
        vals.push(Array.isArray(b[f]) ? b[f] : b[f])
        sets.push(`${f} = $${vals.length}`)
      }
    }
    if (!sets.length) return res.status(400).json({ error: "No fields" })
    vals.push(id)
    const pool = getChatPool()
    await pool.query(`UPDATE fb_conversation SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals)
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
