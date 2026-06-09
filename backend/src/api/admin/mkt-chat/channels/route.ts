import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

async function isManager(req: MedusaRequest): Promise<boolean> {
  const uid = actorId(req)
  if (!uid) return false
  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email", "metadata"] })
  if (user.email === superEmail) return true
  const perms: string[] = Array.isArray((user.metadata as any)?.permissions)
    ? (user.metadata as any).permissions : []
  return perms.includes("page.mkt-chat.manage")
}

// GET /admin/mkt-chat/channels - list channels user is member of
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const manager = await isManager(req)

    const allChannels = await svc.listMktChannels({ deleted_at: null })

    // Filter channels: manager sees all, MKT sees only those they're member of
    const channels = manager
      ? allChannels
      : allChannels.filter((c: any) =>
          Array.isArray(c.members) && c.members.some((m: any) => m.user_id === uid)
        )

    // Add unread count (messages after last_read — simplified: just count recent)
    const enriched = channels.map((c: any) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      member_count: Array.isArray(c.members) ? c.members.length : 0,
      created_at: c.created_at,
    }))

    res.json({ channels: enriched })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/mkt-chat/channels - tạo channel (manager only)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await isManager(req))) return res.status(403).json({ error: "Chỉ manager mới được tạo channel" })

    const { name, description, member_ids } = req.body as any
    if (!name?.trim()) return res.status(400).json({ error: "Tên channel không được rỗng" })

    const svc = req.scope.resolve("mktTaskModule") as any

    const members = [
      { user_id: uid, role: "admin", joined_at: new Date().toISOString() },
      ...(Array.isArray(member_ids) ? member_ids.map((id: string) => ({
        user_id: id, role: "member", joined_at: new Date().toISOString()
      })) : []),
    ]

    const channel = await svc.createMktChannels({
      name: name.trim(),
      description: description || null,
      created_by: uid,
      members,
    })

    res.json({ channel })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
