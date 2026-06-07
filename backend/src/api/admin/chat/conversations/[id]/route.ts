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

    const before = (req.query as any).before  // ISO string — load messages trước thời điểm này
    const msgParams: any[] = [id]
    let msgSql = `SELECT * FROM fb_message WHERE conversation_id = $1`
    if (before) {
      msgParams.push(before)
      msgSql += ` AND created_at < $2`
    }
    msgSql += ` ORDER BY created_at DESC LIMIT 60`  // newest-first rồi reverse ở client

    const messages = await pool.query(msgSql, msgParams)
    const events = await pool.query(
      `SELECT * FROM fb_conversation_event WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [id]
    )
    // Khớp đơn Pancake theo SĐT khách (từ context 24h)
    const phone = conv.rows[0]?.active_phone || null
    let pancakeOrders: any[] = []
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, "")
      const { rows: po } = await pool.query(
        `SELECT id, status_name, customer_name, customer_phone, total, cod_amount,
                tracking_code, province, items, items_count, sale_name, pancake_created_at, tags
         FROM pancake_order
         WHERE regexp_replace(customer_phone, '[^0-9]', '', 'g') = $1
         ORDER BY pancake_created_at DESC NULLS LAST LIMIT 10`,
        [cleanPhone]
      ).catch(() => ({ rows: [] }))
      pancakeOrders = po
    }
    await pool.query(`UPDATE fb_conversation SET unread_count = 0 WHERE id = $1`, [id])
    return res.json({ conversation: c, messages: messages.rows, events: events.rows, orders: pancakeOrders })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth?.isAdmin) return res.status(403).json({ error: "Admin only" })
    const id = (req.params as any).id
    const pool = getChatPool()
    await pool.query(`DELETE FROM fb_conversation WHERE id = $1`, [id])
    return res.json({ ok: true })
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
        vals.push(b[f])
        const cast = f === "tags" ? `::text[]` : ""
        sets.push(`${f} = $${vals.length}${cast}`)
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
