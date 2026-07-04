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
    const search = q.q?.trim() || ""
    const hasSearch = !!search

    // Only hide disabled inbox-sync pages during normal browsing; search should find any DB chat the user can access.
    await pool.query(`ALTER TABLE fb_page_token ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN DEFAULT true`)
    if (!hasSearch) where.push(`c.page_id IN (SELECT page_id FROM fb_page_token WHERE sync_enabled = true)`)

    if (auth.fbPageIds && auth.fbPageIds.length) {
      params.push(auth.fbPageIds)
      where.push(`c.page_id = ANY($${params.length})`)
    } else if (auth.fbPageIds && !auth.fbPageIds.length) {
      where.push(`false`)
    }
    if (!hasSearch && q.status && q.status !== "all") {
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
    if (!hasSearch && q.page_id) {
      params.push(q.page_id)
      where.push(`c.page_id = $${params.length}`)
    }
    if (hasSearch) {
      params.push(`%${search}%`)
      const textParam = params.length
      const clauses = [
        `c.customer_name ILIKE $${textParam}`,
        `c.customer_psid ILIKE $${textParam}`,
        `c.last_message ILIKE $${textParam}`,
        `c.page_name ILIKE $${textParam}`,
        `ctx.active_phone ILIKE $${textParam}`,
      ]
      const digits = search.replace(/\D/g, "")
      if (digits) {
        params.push(`%${digits}%`)
        const phoneParam = params.length
        clauses.push(`regexp_replace(COALESCE(ctx.active_phone, ''), '[^0-9]', '', 'g') LIKE $${phoneParam}`)
        clauses.push(`EXISTS (SELECT 1 FROM fb_message m WHERE m.conversation_id = c.id AND regexp_replace(COALESCE(m.text, ''), '[^0-9]', '', 'g') LIKE $${phoneParam})`)
      }
      where.push(`(${clauses.join(" OR ")})`)
    }
    if (!hasSearch && q.has_phone === "1") {
      where.push(`ctx.active_phone IS NOT NULL AND ctx.active_phone != ''`)
    }

    params.push(limit, offset)
    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : ""
    const fromSql = `FROM fb_conversation c
       LEFT JOIN fb_conversation_context ctx ON ctx.conversation_id = c.id`

    const { rows } = await pool.query(
      `SELECT c.*, ctx.active_phone, ctx.active_address, ctx.active_order_state, a.mode AS bot_mode, a.product_names
       ${fromSql}
       LEFT JOIN fb_bot_agent a ON a.page_id = c.page_id
       ${sqlWhere}
       ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    const count = await pool.query(`SELECT COUNT(*)::int AS total ${fromSql} ${sqlWhere}`, params.slice(0, -2))
    return res.json({ conversations: rows, total: count.rows[0]?.total || 0 })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
