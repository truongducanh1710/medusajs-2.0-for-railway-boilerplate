import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

// GET /admin/mkt-chat/channels/:id/pinned — lấy danh sách tin được ghim
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = (req as any).auth_context
    if (auth?.actor_type !== "user") return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId } = req.params

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
