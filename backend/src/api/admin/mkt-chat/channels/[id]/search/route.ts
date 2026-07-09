import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMktChatAuthInfo, canAccessMktChannel, searchMktMessages } from "../../../_lib"

// GET /admin/mkt-chat/channels/:id/search?q=keyword
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const { id: channelId } = req.params
    const { q, author_id, from, to, limit } = req.query as any
    if (!q?.trim()) return res.json({ messages: [] })

    const svc = req.scope.resolve("mktTaskModule") as any
    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Khong tim thay channel" })
    if (!canAccessMktChannel(channel, auth)) {
      return res.status(403).json({ error: "Ban khong phai thanh vien cua channel nay" })
    }

    const messages = await searchMktMessages(req, {
      q,
      visibleChannelIds: [channelId],
      channelId,
      authorId: author_id,
      from,
      to,
      limit: Number(limit) || 30,
    })

    res.json({ messages })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}