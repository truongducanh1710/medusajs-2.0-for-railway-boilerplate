import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { broadcastToChannel, broadcastToUser, getMktChatAuthInfo } from "../../_lib"

// PATCH /admin/mkt-chat/channels/:id - super admin only (sửa tên/mô tả/riêng tư)
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    if (!auth.isSuper) return res.status(403).json({ error: "Chi super admin moi duoc sua nhom" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    const { name, description, is_private, is_announcement } = req.body as any
    const data: Record<string, any> = { id }
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: "Ten channel khong duoc rong" })
      data.name = String(name).trim()
    }
    if (description !== undefined) data.description = description || null
    if (is_private !== undefined) data.is_private = Boolean(is_private)
    if (is_announcement !== undefined) data.is_announcement = Boolean(is_announcement)

    const updated = await svc.updateMktChannels(data)

    broadcastToChannel(id, "channel.updated", {})
    const memberIds = Array.isArray(channel.members) ? channel.members.map((m: any) => m.user_id) : []
    for (const email of memberIds) {
      broadcastToUser(email, "channel.updated", { channel_id: id })
    }

    res.json({ channel: updated })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// DELETE /admin/mkt-chat/channels/:id - super admin only (xoa mem nhom)
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    if (!auth.isSuper) return res.status(403).json({ error: "Chi super admin moi duoc xoa nhom" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    await svc.softDeleteMktChannels([id])

    const memberIds = Array.isArray(channel.members) ? channel.members.map((m: any) => m.user_id) : []
    broadcastToChannel(id, "channel.deleted", {})
    for (const email of memberIds) {
      broadcastToUser(email, "channel.deleted", { channel_id: id })
    }

    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
