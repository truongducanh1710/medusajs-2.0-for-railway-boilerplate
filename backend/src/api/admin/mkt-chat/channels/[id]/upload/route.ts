import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { ulid } from "ulid"
import { getPool } from "../../../../../../lib/db"
import { broadcastToChannel, formatMktMessage, getMktChatAuthInfo, isMktChannelMember } from "../../../_lib"

const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf", "video/mp4", "video/quicktime",
])
const MAX_SIZE = 20 * 1024 * 1024 // 20MB

// POST /admin/mkt-chat/channels/:id/upload
// multipart/form-data: file
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId } = req.params
    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })
    if (!isMktChannelMember(channel, auth.email, auth.isSuper)) {
      return res.status(403).json({ error: "Bạn không phải thành viên của channel này" })
    }

    // Medusa parse file từ request
    const files = (req as any).files as Record<string, any[]> | undefined
    const fileArr = files?.["file"]
    const file = Array.isArray(fileArr) ? fileArr[0] : fileArr
    if (!file) return res.status(400).json({ error: "Không tìm thấy file" })

    const mimeType: string = file.mimetype || file.type || "application/octet-stream"
    if (!ALLOWED_TYPES.has(mimeType)) {
      return res.status(400).json({ error: `Loại file không được hỗ trợ: ${mimeType}` })
    }
    if (file.size > MAX_SIZE) {
      return res.status(400).json({ error: "File vượt quá 20MB" })
    }

    // Upload lên MinIO qua Medusa file module
    const fileModule = req.scope.resolve(Modules.FILE) as any
    const content = file.buffer ?? require("fs").readFileSync(file.path)

    const result = await fileModule.uploadFiles([{
      filename: `chat/${channelId}/${ulid()}_${file.originalname || file.name}`,
      mimeType,
      content,
      access: "public",
    }])

    const uploadedFile = Array.isArray(result) ? result[0] : result
    const fileUrl: string = uploadedFile.url
    const fileKey: string = uploadedFile.key
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const isImage = mimeType.startsWith("image/")
    const message = await svc.createMktMessages({
      channel_id: channelId,
      author_id: auth.email,
      content: isImage ? "📷 Ảnh" : `📎 ${file.originalname || file.name}`,
      msg_type: isImage ? "image" : "file",
      file_url: fileUrl,
      file_type: mimeType,
      file_name: file.originalname || file.name,
      file_expires_at: expiresAt,
      reactions: {},
      mentions: [],
    })

    // Ghi key + expires vào DB để cleanup job dùng
    await getPool().query(
      `INSERT INTO mkt_chat_file (id, channel_id, message_id, file_key, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT DO NOTHING`,
      [ulid(), channelId, message.id, fileKey, expiresAt]
    ).catch(() => {}) // bảng này optional, không fail nếu chưa có

    const userModule = req.scope.resolve(Modules.USER)
    const user = await userModule.retrieveUser((req as any).auth_context.actor_id, { select: ["first_name", "last_name", "email"] })
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email
    broadcastToChannel(channelId, "message.created", { message: formatMktMessage(message, { [auth.email]: name }) })
    broadcastToChannel(channelId, "channel.updated", {})

    res.json({ message, file_url: fileUrl, expires_at: expiresAt })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
