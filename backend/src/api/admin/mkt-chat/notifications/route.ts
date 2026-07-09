import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ulid } from "ulid"
import { getPool } from "../../../../lib/db"
import { getMktChatAuthInfo } from "../_lib"

const NOTIFY_CHANNEL_ID = "__notify__"

function parseNotification(row: any, lastReadAt?: string | null) {
  try {
    const payload = JSON.parse(row.content || "{}")
    if (payload?.type !== "mention") return null
    return {
      id: row.id,
      recipient: payload.recipient,
      channel_id: payload.channel_id,
      channel_name: payload.channel_name,
      message_id: payload.message_id,
      sender: payload.sender,
      sender_name: payload.sender_name,
      preview: payload.preview || "",
      source: payload.source || "message",
      created_at: row.created_at,
      read: lastReadAt ? new Date(row.created_at).getTime() <= new Date(lastReadAt).getTime() : false,
    }
  } catch {
    return null
  }
}

// GET /admin/mkt-chat/notifications
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const pool = getPool()
    const readResult = await pool.query(
      `SELECT last_read_at FROM mkt_channel_read WHERE channel_id = $1 AND user_email = $2 LIMIT 1`,
      [NOTIFY_CHANNEL_ID, auth.email]
    )
    const lastReadAt = readResult.rows[0]?.last_read_at || null

    const params: any[] = [auth.email]
    const unreadParams: any[] = [auth.email]
    let unreadReadClause = ""
    if (lastReadAt) {
      unreadParams.push(lastReadAt)
      unreadReadClause = `AND created_at > $2`
    }

    const [rowsResult, unreadResult] = await Promise.all([
      pool.query(
        `SELECT id, content, created_at
         FROM mkt_message
         WHERE channel_id = '${NOTIFY_CHANNEL_ID}'
           AND msg_type = 'system_notify'
           AND deleted_at IS NULL
           AND content::jsonb ->> 'type' = 'mention'
           AND content::jsonb ->> 'recipient' = $1
         ORDER BY created_at DESC
         LIMIT 30`,
        params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS cnt
         FROM mkt_message
         WHERE channel_id = '${NOTIFY_CHANNEL_ID}'
           AND msg_type = 'system_notify'
           AND deleted_at IS NULL
           AND content::jsonb ->> 'type' = 'mention'
           AND content::jsonb ->> 'recipient' = $1
           ${unreadReadClause}`,
        unreadParams
      ),
    ])

    const notifications = rowsResult.rows.map(row => parseNotification(row, lastReadAt)).filter(Boolean)
    res.json({ unread_count: unreadResult.rows[0]?.cnt ?? 0, notifications })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}