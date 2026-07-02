import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool, logConversationEvent, refreshConversationContext, sendFacebookMessage } from "../../../_lib"
import { getPancakeConfig, pancakeSendMessage } from "../../../pancake-lib"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const { text, send_to_facebook = true } = (req.body as any) || {}
    if (!text?.trim()) return res.status(400).json({ error: "text required" })
    const pool = getChatPool()
    await ensureChatTables(pool)
    const conv = await pool.query(`SELECT * FROM fb_conversation WHERE id = $1`, [id])
    const c = conv.rows[0]
    if (!c) return res.status(404).json({ error: "Conversation not found" })
    if (auth.fbPageIds && !auth.fbPageIds.includes(c.page_id)) return res.status(403).json({ error: "Forbidden" })

    let fbResult: any = null
    let fbMessageId: string | null = null
    let channel: string | null = null
    if (send_to_facebook) {
      // Prefer Pancake when a token is configured for this page (Facebook App may not
      // yet be approved for messaging). Fall back to the Graph API otherwise.
      const pancake = await getPancakeConfig(pool, c.page_id)
      if (pancake) {
        fbMessageId = await pancakeSendMessage(pancake, c.customer_psid, text)
        fbResult = { via: "pancake", message_id: fbMessageId }
        channel = "pancake"
      } else {
        fbResult = await sendFacebookMessage(c.page_id, c.customer_psid, text)
        fbMessageId = fbResult?.message_id || null
        channel = "facebook"
      }
    }

    const msg = await pool.query(
      `INSERT INTO fb_message (conversation_id, fb_message_id, direction, sender_type, text, raw_payload)
       VALUES ($1,$2,'outbound','sale',$3,$4) RETURNING *`,
      [id, fbMessageId, text, JSON.stringify({ fbResult, actor: auth.email })]
    )
    await pool.query(
      `UPDATE fb_conversation SET last_message = $2, last_message_at = now(), status = CASE WHEN status IN ('handoff','complaint') THEN 'assigned' ELSE status END, bot_paused = true, assigned_to = COALESCE(assigned_to, $3), updated_at = now() WHERE id = $1`,
      [id, text, auth.email]
    )
    await logConversationEvent(pool, id, "manual_reply_sent", "sale", auth.email, { text, send_to_facebook, channel })
    await maybeCreateReplyExample(pool, id, auth.email, text)
    await refreshConversationContext(pool, id)
    return res.json({ ok: true, message: msg.rows[0], fb: fbResult })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

async function maybeCreateReplyExample(pool: any, conversationId: string, saleId: string, saleReply: string) {
  const handoff = await pool.query(`SELECT * FROM fb_conversation WHERE id = $1 AND handoff_reason IS NOT NULL`, [conversationId])
  const c = handoff.rows[0]
  if (!c) return
  const prev = await pool.query(
    `SELECT text FROM fb_message WHERE conversation_id = $1 AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  )
  const customerText = prev.rows[0]?.text
  if (!customerText) return
  const ctx = await pool.query(`SELECT * FROM fb_conversation_context WHERE conversation_id = $1`, [conversationId])
  await pool.query(
    `INSERT INTO fb_bot_reply_example
      (page_id, page_name, product_name, customer_text, active_window_summary, bot_handoff_reason, sale_reply, sale_id, review_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
    [c.page_id, c.page_name, c.active_product_interest, customerText, ctx.rows[0]?.active_window_summary || "", c.handoff_reason, saleReply, saleId]
  )
}
