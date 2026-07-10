import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { ulid } from "ulid"
import { getPool } from "../../../../../../lib/db"
import { broadcastToChannel, formatMktMessage, getMktChatAuthInfo, canAccessMktChannel } from "../../../_lib"

const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf", "video/mp4", "video/quicktime",
])
const MAX_SIZE = 20 * 1024 * 1024 // 20MB

function getUploadName(file: any): string {
  return String(file?.originalname || file?.name || file?.filename || "upload")
}

function readUploadContent(file: any): Buffer {
  if (Buffer.isBuffer(file?.buffer)) return file.buffer
  if (file?.path) return require("fs").readFileSync(file.path)
  throw new Error("Khong doc duoc noi dung file upload")
}
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
    if (!canAccessMktChannel(channel, auth)) {
      return res.status(403).json({ error: "Bạn không phải thành viên của channel này" })
    }

    const file = (req as any).file
    if (!file) return res.status(400).json({ error: "Khong tim thay file upload. Hay thu lai voi anh nho hon 20MB." })

    const mimeType: string = file.mimetype || file.type || file.mimeType || "application/octet-stream"
    if (!ALLOWED_TYPES.has(mimeType)) {
      return res.status(400).json({ error: `Loai file khong duoc ho tro: ${mimeType}` })
    }

    const content = readUploadContent(file)
    const actualSize = Number(file.size || content.length || 0)
    if (actualSize > MAX_SIZE) {
      return res.status(400).json({ error: "File vuot qua 20MB" })
    }

    const originalName = getUploadName(file)
    const fileModule = req.scope.resolve(Modules.FILE) as any
    const uploadedFile = await fileModule.createFiles({
      filename: `chat/${channelId}/${ulid()}_${originalName}`,
      mimeType,
      content: content.toString("base64"),
      access: "public",
    })

    const fileUrl: string = uploadedFile?.url
    const fileKey: string = uploadedFile?.id || fileUrl
    if (!fileUrl) throw new Error("Upload xong nhung khong nhan duoc URL file")
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const isImage = mimeType.startsWith("image/")
    const message = await svc.createMktMessages({
      channel_id: channelId,
      author_id: auth.email,
      content: isImage ? "Anh" : `File: ${originalName}`,
      msg_type: isImage ? "image" : "file",
      file_url: fileUrl,
      file_type: mimeType,
      file_name: originalName,
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
    const formattedMessage = formatMktMessage(message, { [auth.email]: name })
    broadcastToChannel(channelId, "message.created", { message: formattedMessage })
    broadcastToChannel(channelId, "channel.updated", {})

    res.json({ message: formattedMessage, file_url: fileUrl, expires_at: expiresAt })
  } catch (e: any) {
    console.error("[mkt-chat/upload]", e)
    res.status(500).json({ error: e.message })
  }
}
