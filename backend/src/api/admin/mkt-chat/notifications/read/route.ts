import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ulid } from "ulid"
import { getPool } from "../../../../../lib/db"
import { broadcastToUser, getMktChatAuthInfo } from "../../_lib"

const NOTIFY_CHANNEL_ID = "__notify__"

// PATCH /admin/mkt-chat/notifications/read
// Body { channel_id } (tuỳ chọn): chỉ clear mention thuộc channel đó — dùng khi
// user MỞ channel và đã đọc tin (để chuông ngừng ting ting). Không có channel_id:
// clear TẤT CẢ mention (dùng khi bấm "Đã đọc" ở chuông).
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const pool = getPool()
    const now = new Date().toISOString()
    const channelId = String((req.body as any)?.channel_id || "").trim()

    if (channelId) {
      // Soft-delete các notify mention của recipient thuộc channel này. Unread
      // count (GET) đếm theo dòng còn sống nên xoá mềm là đủ để tắt chuông.
      await pool.query(
        `UPDATE mkt_message
         SET deleted_at = now(), updated_at = now()
         WHERE channel_id = $1
           AND msg_type = 'system_notify'
           AND deleted_at IS NULL
           AND content::jsonb ->> 'type' = 'mention'
           AND content::jsonb ->> 'recipient' = $2
           AND content::jsonb ->> 'channel_id' = $3`,
        [NOTIFY_CHANNEL_ID, auth.email, channelId]
      )
    } else {
      await pool.query(
        `INSERT INTO mkt_channel_read (id, channel_id, user_email, last_read_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (channel_id, user_email) DO UPDATE SET last_read_at = $4, updated_at = $6`,
        [ulid(), NOTIFY_CHANNEL_ID, auth.email, now, now, now]
      )
    }

    // Tính lại unread thực tế sau khi clear (per-channel có thể vẫn còn mention channel khác).
    const readResult = await pool.query(
      `SELECT last_read_at FROM mkt_channel_read WHERE channel_id = $1 AND user_email = $2 LIMIT 1`,
      [NOTIFY_CHANNEL_ID, auth.email]
    )
    const lastReadAt = readResult.rows[0]?.last_read_at || null
    const unreadParams: any[] = [auth.email]
    let unreadReadClause = ""
    if (lastReadAt) {
      unreadParams.push(lastReadAt)
      unreadReadClause = `AND created_at > $2`
    }
    const unreadResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM mkt_message
       WHERE channel_id = '${NOTIFY_CHANNEL_ID}'
         AND msg_type = 'system_notify'
         AND deleted_at IS NULL
         AND content::jsonb ->> 'type' = 'mention'
         AND content::jsonb ->> 'recipient' = $1
         ${unreadReadClause}`,
      unreadParams
    )
    const unreadCount = unreadResult.rows[0]?.cnt ?? 0

    broadcastToUser(auth.email, "mention.notifications.read", { unread_count: unreadCount })
    res.json({ ok: true, unread_count: unreadCount })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}