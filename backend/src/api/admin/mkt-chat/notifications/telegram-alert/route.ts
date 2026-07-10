import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../../lib/db"
import { notifyTelegramByEmail } from "../../../../../lib/notify"
import { getMktChatAuthInfo } from "../../_lib"

const NOTIFY_CHANNEL_ID = "__notify__"

// POST /admin/mkt-chat/notifications/telegram-alert
// Gọi khi nhạc chuông nhắc lại vẫn chưa được đọc — báo qua Telegram cho case user rời máy.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
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
    let readClause = ""
    if (lastReadAt) {
      params.push(lastReadAt)
      readClause = `AND created_at > $2`
    }

    const unreadResult = await pool.query(
      `SELECT content, created_at
       FROM mkt_message
       WHERE channel_id = '${NOTIFY_CHANNEL_ID}'
         AND msg_type = 'system_notify'
         AND deleted_at IS NULL
         AND content::jsonb ->> 'type' = 'mention'
         AND content::jsonb ->> 'recipient' = $1
         ${readClause}
       ORDER BY created_at DESC
       LIMIT 5`,
      params
    )

    if (unreadResult.rows.length === 0) {
      return res.json({ ok: true, sent: false, reason: "no_unread" })
    }

    const latest = JSON.parse(unreadResult.rows[0].content || "{}")
    const text = [
      `🔔 <b>Nhắc mention chưa đọc</b>`,
      `✉️ Từ: ${latest.sender_name || latest.sender || "?"}`,
      `#${latest.channel_name || ""}`,
      latest.preview ? `"${latest.preview}"` : "",
      unreadResult.rows.length > 1 ? `\n+ ${unreadResult.rows.length - 1} mention khác chưa đọc` : "",
    ].filter(Boolean).join("\n")

    const userModule = req.scope.resolve(Modules.USER)
    await notifyTelegramByEmail(userModule, auth.email, text)
    res.json({ ok: true, sent: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
