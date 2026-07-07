import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { broadcastToChannel, getMktChatAuthInfo, isMktChannelMember } from "../../../../../_lib"

// POST /admin/mkt-chat/channels/:id/messages/:msgId/react
// body: { emoji: "👍" }  — toggle reaction
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId, msgId } = req.params
    const { emoji } = req.body as any
    if (!emoji) return res.status(400).json({ error: "Thiếu emoji" })

    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })
    if (!isMktChannelMember(channel, auth.email, auth.isSuper)) {
      return res.status(403).json({ error: "Bạn không phải thành viên của channel này" })
    }

    const [msg] = await svc.listMktMessages({ id: msgId, channel_id: channelId, deleted_at: null })
    if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" })

    // reactions: { "👍": ["email1","email2"], ... }
    const reactions: Record<string, string[]> = typeof msg.reactions === "object" && msg.reactions
      ? { ...msg.reactions }
      : {}

    if (!reactions[emoji]) reactions[emoji] = []
    const idx = reactions[emoji].indexOf(auth.email)
    if (idx >= 0) {
      reactions[emoji].splice(idx, 1)
      if (reactions[emoji].length === 0) delete reactions[emoji]
    } else {
      reactions[emoji].push(auth.email)
    }

    await svc.updateMktMessages({ id: msgId, reactions })
    broadcastToChannel(channelId, "message.updated", { message_id: msgId, reactions })
    res.json({ reactions })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
