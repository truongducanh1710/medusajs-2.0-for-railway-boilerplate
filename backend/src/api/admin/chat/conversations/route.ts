import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool } from "../_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const pool = getChatPool()
    await ensureChatTables(pool)

    const q = req.query as Record<string, string>
    const limit = Math.min(parseInt(q.limit || "50", 10), 100)
    const offset = Math.max(parseInt(q.offset || "0", 10), 0)
    const params: any[] = []
    const where: string[] = []

    if (auth.fbPageIds && auth.fbPageIds.length) {
      params.push(auth.fbPageIds)
      where.push(`c.page_id = ANY($${params.length})`)
    } else if (auth.fbPageIds && !auth.fbPageIds.length) {
      where.push(`false`)
    }
    if (q.status && q.status !== "all") {
      if (q.status === "mine") {
        params.push(auth.email)
        where.push(`c.assigned_to = $${params.length}`)
      } else if (q.status === "unread") {
        where.push(`c.unread_count > 0`)
      } else {
        params.push(q.status)
        where.push(`c.status = $${params.length}`)
      }
    }
    if (q.page_id) {
      params.push(q.page_id)
      where.push(`c.page_id = $${params.length}`)
    }
    if (q.q) {
      params.push(`%${q.q}%`)
      where.push(`(c.customer_name ILIKE $${params.length} OR c.last_message ILIKE $${params.length} OR c.page_name ILIKE $${params.length})`)
    }

    params.push(limit, offset)
    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : ""
    const { rows } = await pool.query(
      `SELECT c.*, ctx.active_phone, ctx.active_address, ctx.active_order_state, a.mode AS bot_mode, a.product_names
       FROM fb_conversation c
       LEFT JOIN fb_conversation_context ctx ON ctx.conversation_id = c.id
       LEFT JOIN fb_bot_agent a ON a.page_id = c.page_id
       ${sqlWhere}
       ORDER BY
         CASE c.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
         COALESCE(c.handoff_at, c.last_message_at, c.updated_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM fb_conversation c ${sqlWhere}`, params.slice(0, -2))
    return res.json({ conversations: rows, total: count.rows[0]?.total || 0 })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
