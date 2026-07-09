import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMktChatAuthInfo, listVisibleMktChannelIds, searchMktMessages } from "../_lib"

// GET /admin/mkt-chat/search?q=&channel_id=&author_id=&from=&to=&limit=
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const { q, channel_id, author_id, from, to, limit } = req.query as any
    if (!q?.trim()) return res.json({ messages: [] })

    const visibleChannelIds = await listVisibleMktChannelIds(req, auth)
    const messages = await searchMktMessages(req, {
      q,
      visibleChannelIds,
      channelId: channel_id,
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