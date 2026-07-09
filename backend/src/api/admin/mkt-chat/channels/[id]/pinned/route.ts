import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getMktChatAuthInfo, canAccessMktChannel } from "../../../_lib"

// GET /admin/mkt-chat/channels/:id/pinned — lấy danh sách tin được ghim
export async function GET(req: MedusaRequest, res: MedusaResponse) {
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

    const pinned = await svc.listMktMessages(
      { channel_id: channelId, is_pinned: true, deleted_at: null },
      { order: { created_at: "DESC" }, take: 20 }
    )

    const userModule = req.scope.resolve(Modules.USER)
    const allUsers = await userModule.listUsers({}, { select: ["email", "first_name", "last_name"] })
    const nameByEmail: Record<string, string> = {}
    for (const u of allUsers) nameByEmail[u.email] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email

    const enriched = pinned.map((m: any) => ({
      ...m,
      author_name: m.author_id === "ai" ? "AI Assistant" : (nameByEmail[m.author_id] || m.author_id),
    }))

    res.json({ pinned: enriched })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
