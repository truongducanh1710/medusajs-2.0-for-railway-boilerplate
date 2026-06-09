import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

// PATCH /admin/mkt-chat/channels/:id/members
// body: { add?: string[], remove?: string[] }
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { add, remove } = req.body as any

    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    let members: any[] = Array.isArray(channel.members) ? [...channel.members] : []

    if (Array.isArray(remove)) {
      members = members.filter((m: any) => !remove.includes(m.user_id))
    }
    if (Array.isArray(add)) {
      const existing = new Set(members.map((m: any) => m.user_id))
      for (const user_id of add) {
        if (!existing.has(user_id)) {
          members.push({ user_id, role: "member", joined_at: new Date().toISOString() })
        }
      }
    }

    await svc.updateMktChannels({ id }, { members })
    res.json({ success: true, member_count: members.length })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
