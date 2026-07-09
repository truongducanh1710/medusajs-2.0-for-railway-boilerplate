import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../../../lib/db"
import { ulid } from "ulid"
import { broadcastToChannel, getMktChatAuthInfo, canAccessMktChannel } from "../../../_lib"

// POST /admin/mkt-chat/channels/:id/typing
// Client ping mỗi ~2.5s khi đang gõ; presence trả về trong GET messages
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId } = req.params
    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })
    if (!canAccessMktChannel(channel, auth)) {
      return res.status(403).json({ error: "Bạn không phải thành viên của channel này" })
    }

    // Insert với last_read_at = epoch để không vô tình mark-read; update chỉ đụng typing_at
    const now = new Date().toISOString()
    await getPool().query(
      `INSERT INTO mkt_channel_read (id, channel_id, user_email, last_read_at, typing_at, created_at, updated_at)
       VALUES ($1, $2, $3, '1970-01-01T00:00:00Z', $4, $4, $4)
       ON CONFLICT (channel_id, user_email) DO UPDATE SET typing_at = $4, updated_at = $4`,
      [ulid(), channelId, auth.email, now]
    )

    const userModule = req.scope.resolve(Modules.USER)
    const users = await userModule.listUsers({}, { select: ["email", "first_name", "last_name"] })
    const me = users.find((u: any) => u.email === auth.email)
    const name = me ? [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email : auth.email
    broadcastToChannel(channelId, "typing.started", { email: auth.email, name })

    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
