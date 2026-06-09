import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

// Identity key trong toàn feature mkt-chat = email (đồng bộ với mkt-tasks & permissions/mkt-users)
async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const uid = actorId(req)
  if (!uid) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email"] })
  return user?.email ?? null
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
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const manager = await isManager(req)

    const allChannels = await svc.listMktChannels({ deleted_at: null })

    // Filter channels: manager sees all, MKT sees only those they're member of (key = email)
    const channels = manager
      ? allChannels
      : allChannels.filter((c: any) =>
          Array.isArray(c.members) && c.members.some((m: any) => m.user_id === email)
        )

    // Add unread count (messages after last_read — simplified: just count recent)
    const enriched = channels.map((c: any) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      member_count: Array.isArray(c.members) ? c.members.length : 0,
      member_ids: Array.isArray(c.members) ? c.members.map((m: any) => m.user_id) : [],
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
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await isManager(req))) return res.status(403).json({ error: "Chỉ manager mới được tạo channel" })

    const { name, description, member_ids } = req.body as any
    if (!name?.trim()) return res.status(400).json({ error: "Tên channel không được rỗng" })

    const svc = req.scope.resolve("mktTaskModule") as any

    // member_ids từ frontend là email. Creator cũng dùng email để đồng nhất key.
    const memberEmails = Array.isArray(member_ids) ? member_ids.filter((e: string) => e && e !== email) : []
    const members = [
      { user_id: email, role: "admin", joined_at: new Date().toISOString() },
      ...memberEmails.map((m: string) => ({
        user_id: m, role: "member", joined_at: new Date().toISOString()
      })),
    ]

    const channel = await svc.createMktChannels({
      name: name.trim(),
      description: description || null,
      created_by: email,
      members,
    })

    res.json({ channel })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
