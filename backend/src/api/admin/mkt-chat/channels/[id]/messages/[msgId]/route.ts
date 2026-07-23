import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { broadcastToChannel, getMktChatAuthInfo } from "../../../../_lib"

const RECALL_WINDOW_MS = 24 * 60 * 60 * 1000
// Cửa sổ sửa nội dung DÀI HƠN recall (24h) rất nhiều — mục đích chính là agent AI cập
// nhật tiến độ 1 tin trong lúc chạy tool-loop (vài chục giây tới vài phút), không phải
// sửa tin cũ. Không giới hạn = vĩnh viễn thì có thể bị lạm dụng để "chỉnh sửa lịch sử"
// sau này; 30 phút đủ rộng cho mọi tác vụ agent thực tế hiện có (trần TOOL_LOOP_BUDGET_MS
// bên agent-mcp là 120s) mà vẫn có giới hạn rõ ràng.
const EDIT_WINDOW_MS = 30 * 60 * 1000

// PATCH /admin/mkt-chat/channels/:id/messages/:msgId — sửa nội dung tin của chính mình
// (trong 30 phút). Dùng cho agent AI cập nhật 1 tin theo tiến độ thay vì gửi nhiều tin
// rời cho từng bước xử lý.
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId, msgId } = req.params
    const { content } = req.body as any
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "Thiếu content" })
    }

    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    const [msg] = await svc.listMktMessages({ id: msgId, channel_id: channelId, deleted_at: null })
    if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" })
    if (msg.recalled_at) return res.status(400).json({ error: "Tin nhắn đã thu hồi, không sửa được" })
    if (msg.author_id !== auth.email) return res.status(403).json({ error: "Chỉ được sửa tin nhắn của chính mình" })

    const age = Date.now() - new Date(msg.created_at).getTime()
    if (age > EDIT_WINDOW_MS) {
      return res.status(400).json({ error: "Chỉ sửa được tin nhắn trong vòng 30 phút sau khi gửi" })
    }

    const editedAt = new Date()
    await svc.updateMktMessages({ id: msgId, content, edited_at: editedAt })

    broadcastToChannel(channelId, "message.updated", { message_id: msgId, content, edited_at: editedAt.toISOString() })

    res.json({ content, edited_at: editedAt.toISOString() })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// DELETE /admin/mkt-chat/channels/:id/messages/:msgId — thu hồi tin nhắn của chính mình (trong 24h)
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId, msgId } = req.params

    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    const [msg] = await svc.listMktMessages({ id: msgId, channel_id: channelId, deleted_at: null })
    if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" })
    if (msg.recalled_at) return res.status(400).json({ error: "Tin nhắn đã được thu hồi" })
    if (msg.author_id !== auth.email) return res.status(403).json({ error: "Chỉ được thu hồi tin nhắn của chính mình" })

    const age = Date.now() - new Date(msg.created_at).getTime()
    if (age > RECALL_WINDOW_MS) {
      return res.status(400).json({ error: "Chỉ thu hồi được tin nhắn trong vòng 24 giờ" })
    }

    const recalledAt = new Date()
    await svc.updateMktMessages({ id: msgId, recalled_at: recalledAt })

    broadcastToChannel(channelId, "message.updated", { message_id: msgId, recalled_at: recalledAt.toISOString() })
    broadcastToChannel(channelId, "channel.updated", {})

    res.json({ recalled_at: recalledAt.toISOString() })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
