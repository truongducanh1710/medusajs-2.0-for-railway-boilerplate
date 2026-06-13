import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["email", "metadata"] })
  return user?.email ?? null
}

async function isManager(req: MedusaRequest, email: string): Promise<boolean> {
  if (email === process.env.SUPER_ADMIN_EMAIL) return true
  const auth = (req as any).auth_context
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["metadata"] })
  const perms: string[] = Array.isArray((user.metadata as any)?.permissions)
    ? (user.metadata as any).permissions : []
  return perms.includes("page.mkt-chat.manage")
}

// POST /admin/mkt-chat/channels/:id/messages/:msgId/pin  — toggle pin (manager only)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await isManager(req, email))) return res.status(403).json({ error: "Chỉ manager mới ghim được" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId, msgId } = req.params

    const [msg] = await svc.listMktMessages({ id: msgId, channel_id: channelId, deleted_at: null })
    if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" })

    const newPinned = !msg.is_pinned
    await svc.updateMktMessages({ id: msgId, is_pinned: newPinned })

    // Post system message
    const userModule = req.scope.resolve(Modules.USER)
    const u = await userModule.retrieveUser((req as any).auth_context.actor_id, { select: ["first_name", "last_name", "email"] })
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
    await svc.createMktMessages({
      channel_id: channelId,
      author_id: "system",
      content: newPinned ? `📌 ${name} đã ghim một tin nhắn` : `${name} đã bỏ ghim tin nhắn`,
      msg_type: "system",
      reactions: {},
      mentions: [],
    })

    res.json({ is_pinned: newPinned })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
