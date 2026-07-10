import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { broadcastToChannel, broadcastToUser, getMktChatAuthInfo, syncSseClientChannel } from "../../../_lib"

// PATCH /admin/mkt-chat/channels/:id/members
// body: { add?: string[], remove?: string[] }
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { add, remove } = req.body as any

    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    const beforeMembers: any[] = Array.isArray(channel.members) ? [...channel.members] : []
    let members: any[] = [...beforeMembers]

    if (Array.isArray(remove)) {
      // Không bao giờ bỏ người tạo (admin) khỏi channel
      members = members.filter((m: any) => !remove.includes(m.user_id) || m.user_id === channel.created_by)
    }
    if (Array.isArray(add)) {
      const existing = new Set(members.map((m: any) => m.user_id))
      for (const user_id of add) {
        if (!existing.has(user_id)) {
          members.push({ user_id, role: "member", joined_at: new Date().toISOString() })
        }
      }
    }

    await svc.updateMktChannels({ id, members })

    const beforeIds = new Set(beforeMembers.map((m: any) => m.user_id))
    const memberIds = members.map((m: any) => m.user_id)
    const afterIds = new Set(memberIds)
    const actuallyAdded = memberIds.filter((email: string) => !beforeIds.has(email))
    const actuallyRemoved = beforeMembers.map((m: any) => m.user_id).filter((email: string) => !afterIds.has(email))
    syncSseClientChannel(id, actuallyAdded, actuallyRemoved)

    const affected = new Set([...beforeMembers.map((m: any) => m.user_id), ...memberIds])
    broadcastToChannel(id, "channel.member.updated", { member_ids: memberIds })
    broadcastToChannel(id, "channel.updated", {})
    for (const email of affected) {
      broadcastToUser(email, "channel.member.updated", { channel_id: id, member_ids: memberIds })
    }

    res.json({ success: true, member_count: members.length })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
