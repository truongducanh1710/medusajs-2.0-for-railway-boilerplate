import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ulid } from "ulid"
import { getPool } from "../../../../../lib/db"
import { broadcastToUser, getMktChatAuthInfo } from "../../_lib"

const NOTIFY_CHANNEL_ID = "__notify__"

// PATCH /admin/mkt-chat/notifications/read
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const now = new Date().toISOString()
    await getPool().query(
      `INSERT INTO mkt_channel_read (id, channel_id, user_email, last_read_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (channel_id, user_email) DO UPDATE SET last_read_at = $4, updated_at = $6`,
      [ulid(), NOTIFY_CHANNEL_ID, auth.email, now, now, now]
    )

    broadcastToUser(auth.email, "mention.notifications.read", { unread_count: 0 })
    res.json({ ok: true, unread_count: 0 })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}