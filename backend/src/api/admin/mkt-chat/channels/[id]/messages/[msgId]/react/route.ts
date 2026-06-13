import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["email"] })
  return user?.email ?? null
}

// POST /admin/mkt-chat/channels/:id/messages/:msgId/react
// body: { emoji: "👍" }  — toggle reaction
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { msgId } = req.params
    const { emoji } = req.body as any
    if (!emoji) return res.status(400).json({ error: "Thiếu emoji" })

    const [msg] = await svc.listMktMessages({ id: msgId, deleted_at: null })
    if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" })

    // reactions: { "👍": ["email1","email2"], ... }
    const reactions: Record<string, string[]> = typeof msg.reactions === "object" && msg.reactions
      ? { ...msg.reactions }
      : {}

    if (!reactions[emoji]) reactions[emoji] = []
    const idx = reactions[emoji].indexOf(email)
    if (idx >= 0) {
      reactions[emoji].splice(idx, 1)
      if (reactions[emoji].length === 0) delete reactions[emoji]
    } else {
      reactions[emoji].push(email)
    }

    await svc.updateMktMessages({ id: msgId, reactions })
    res.json({ reactions })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
