import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../../../lib/db"
import { ulid } from "ulid"
import { broadcastToUser, getMktChatAuthInfo, isMktChannelMember } from "../../../_lib"

// PATCH /admin/mkt-chat/channels/:id/last-read
// Đánh dấu user đã đọc đến thời điểm hiện tại trong channel này
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId } = req.params
    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })
    if (!isMktChannelMember(channel, auth.email, auth.isSuper)) {
      return res.status(403).json({ error: "Bạn không phải thành viên của channel này" })
    }

    const now = new Date().toISOString()
    await getPool().query(
      `INSERT INTO mkt_channel_read (id, channel_id, user_email, last_read_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (channel_id, user_email) DO UPDATE SET last_read_at = $4, updated_at = $6`,
      [ulid(), channelId, auth.email, now, now, now]
    )

    broadcastToUser(auth.email, "read.updated", { channel_id: channelId })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
