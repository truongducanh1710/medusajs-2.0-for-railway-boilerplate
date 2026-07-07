import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { broadcastToChannel, formatMktMessage, getMktChatAuthInfo } from "../../../../../_lib"

// POST /admin/mkt-chat/channels/:id/messages/:msgId/pin — toggle pin (manager only)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    if (!auth.isManager) return res.status(403).json({ error: "Chỉ manager mới ghim được" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId, msgId } = req.params

    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    const [msg] = await svc.listMktMessages({ id: msgId, channel_id: channelId, deleted_at: null })
    if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" })

    const newPinned = !msg.is_pinned
    await svc.updateMktMessages({ id: msgId, is_pinned: newPinned })

    const userModule = req.scope.resolve(Modules.USER)
    const u = await userModule.retrieveUser((req as any).auth_context.actor_id, { select: ["first_name", "last_name", "email"] })
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
    const systemMessage = await svc.createMktMessages({
      channel_id: channelId,
      author_id: "system",
      content: newPinned ? `📌 ${name} đã ghim một tin nhắn` : `${name} đã bỏ ghim tin nhắn`,
      msg_type: "system",
      reactions: {},
      mentions: [],
    })

    broadcastToChannel(channelId, "message.updated", { message_id: msgId, is_pinned: newPinned })
    broadcastToChannel(channelId, "message.created", { message: formatMktMessage(systemMessage, { [u.email]: name }) })
    broadcastToChannel(channelId, "channel.updated", {})

    res.json({ is_pinned: newPinned })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
