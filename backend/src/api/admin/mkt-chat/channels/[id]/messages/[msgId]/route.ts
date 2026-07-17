import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { broadcastToChannel, getMktChatAuthInfo } from "../../../../_lib"

const RECALL_WINDOW_MS = 24 * 60 * 60 * 1000

// DELETE /admin/mkt-chat/channels/:id/messages/:msgId — thu hồi tin nhắn của chính mình (trong 24h)
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId, msgId } = req.params

    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    const [msg] = await svc.listMktMessages({ id: msgId, channel_id: channelId, deleted_at: null })
    if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" })
    if (msg.recalled_at) return res.status(400).json({ error: "Tin nhắn đã được thu hồi" })
    if (msg.author_id !== auth.email) return res.status(403).json({ error: "Chỉ được thu hồi tin nhắn của chính mình" })

    const age = Date.now() - new Date(msg.created_at).getTime()
    if (age > RECALL_WINDOW_MS) {
      return res.status(400).json({ error: "Chỉ thu hồi được tin nhắn trong vòng 24 giờ" })
    }

    const recalledAt = new Date()
    await svc.updateMktMessages({ id: msgId, recalled_at: recalledAt })

    broadcastToChannel(channelId, "message.updated", { message_id: msgId, recalled_at: recalledAt.toISOString() })
    broadcastToChannel(channelId, "channel.updated", {})

    res.json({ recalled_at: recalledAt.toISOString() })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
