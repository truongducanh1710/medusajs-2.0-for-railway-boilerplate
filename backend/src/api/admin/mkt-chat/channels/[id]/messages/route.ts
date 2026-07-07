import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../../../lib/db"
import { broadcastToChannel, formatMktMessage } from "../../../_lib"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const uid = actorId(req)
  if (!uid) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email"] })
  return user?.email ?? null
}

function isMember(channel: any, email: string): boolean {
  return Array.isArray(channel.members) && channel.members.some((m: any) => m.user_id === email)
}

// Parse @mention: "@tên" hoặc "@email" trong nội dung, trả list email matches
function parseMentions(content: string, memberEmails: string[], nameByEmail: Record<string, string>): string[] {
  const mentioned = new Set<string>()
  // Tìm tất cả @word patterns
  const matches = content.match(/@[\w.@-]+/g) || []
  for (const m of matches) {
    const token = m.slice(1).toLowerCase()
    if (token === "ai") continue
    for (const email of memberEmails) {
      if (email.toLowerCase().includes(token)) { mentioned.add(email); break }
      const name = nameByEmail[email]?.toLowerCase() ?? ""
      if (name && name.includes(token)) { mentioned.add(email); break }
    }
  }
  return [...mentioned]
}

// GET /admin/mkt-chat/channels/:id/messages
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { before, limit = "50" } = req.query as any

    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    // 403: chỉ member mới đọc được
    const superEmail = process.env.SUPER_ADMIN_EMAIL
    if (email !== superEmail && !isMember(channel, email)) {
      return res.status(403).json({ error: "Bạn không phải thành viên của channel này" })
    }

    const filter: any = { channel_id: id, deleted_at: null }
    if (before) filter.created_at = { $lt: new Date(before) }

    const messages = await svc.listMktMessages(filter, {
      order: { created_at: "DESC" },
      take: Math.min(Number(limit), 100),
    })

    // Resolve author names
    const userModule = req.scope.resolve(Modules.USER)
    const allUsers = await userModule.listUsers({}, { select: ["email", "first_name", "last_name"] })
    const nameByEmail: Record<string, string> = {}
    for (const u of allUsers) {
      nameByEmail[u.email] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
    }

    // Resolve reply_to snippet
    const replyIds = [...new Set(messages.map((m: any) => m.reply_to_id).filter(Boolean))]
    const replyMap: Record<string, any> = {}
    if (replyIds.length > 0) {
      const replies = await svc.listMktMessages({ id: { $in: replyIds } }, { select: ["id", "content", "author_id", "msg_type"] })
      for (const r of replies) {
        replyMap[r.id] = {
          id: r.id,
          content: r.content.slice(0, 80),
          author_name: r.author_id === "ai" ? "AI Assistant" : (nameByEmail[r.author_id] || r.author_id),
        }
      }
    }

    const enriched = messages.reverse().map((m: any) => ({
      ...m,
      author_name: m.author_id === "ai" ? "AI Assistant" : (nameByEmail[m.author_id] || m.author_id),
      reply_to: m.reply_to_id ? replyMap[m.reply_to_id] : null,
    }))

    // Presence: online = có hoạt động (last-read upsert) trong 2 phút; typing = typing_at trong 6s
    let online: string[] = []
    let typing: string[] = []
    try {
      const memberEmails: string[] = Array.isArray(channel.members)
        ? channel.members.map((m: any) => m.user_id)
        : []
      if (memberEmails.length > 0) {
        const pres = await getPool().query(
          `SELECT user_email,
                  MAX(updated_at) AS seen_at,
                  MAX(typing_at) FILTER (WHERE channel_id = $1) AS typing_at
           FROM mkt_channel_read
           WHERE user_email = ANY($2)
           GROUP BY user_email`,
          [id, memberEmails]
        )
        const now = Date.now()
        for (const row of pres.rows) {
          if (row.seen_at && now - new Date(row.seen_at).getTime() < 120_000) online.push(row.user_email)
          if (row.typing_at && now - new Date(row.typing_at).getTime() < 6_000 && row.user_email !== email) {
            typing.push(nameByEmail[row.user_email] || row.user_email)
          }
        }
      }
    } catch { /* presence là best-effort, không chặn messages */ }

    res.json({ messages: enriched, presence: { online, typing } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/mkt-chat/channels/:id/messages
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { content, reply_to_id, msg_type } = req.body as any
    if (!content?.trim()) return res.status(400).json({ error: "Nội dung không được rỗng" })
    // Chỉ cho phép 2 loại từ client; mọi giá trị khác fallback về text
    const messageType = msg_type === "internal_note" ? "internal_note" : "text"

    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    // 403: chỉ member mới gửi được
    const superEmail = process.env.SUPER_ADMIN_EMAIL
    if (email !== superEmail && !isMember(channel, email)) {
      return res.status(403).json({ error: "Bạn không phải thành viên của channel này" })
    }

    // Resolve names để parse mention
    const userModule = req.scope.resolve(Modules.USER)
    const allUsers = await userModule.listUsers({}, { select: ["email", "first_name", "last_name"] })
    const nameByEmail: Record<string, string> = {}
    for (const u of allUsers) {
      nameByEmail[u.email] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
    }
    const memberEmails: string[] = Array.isArray(channel.members)
      ? channel.members.map((m: any) => m.user_id)
      : []

    const mentions = parseMentions(content.trim(), memberEmails, nameByEmail)
    // @ai không chạy trong internal note
    const isAiCommand = messageType === "text" && content.trim().toLowerCase().startsWith("@ai ")
    const question = isAiCommand ? content.trim().slice(4).trim() : ""

    const message = await svc.createMktMessages({
      channel_id: id,
      author_id: email,
      content: content.trim(),
      msg_type: messageType,
      reply_to_id: reply_to_id || null,
      reactions: {},
      mentions,
    })
    const formattedMessage = formatMktMessage(message, nameByEmail)
    broadcastToChannel(id, "message.created", { message: formattedMessage })
    broadcastToChannel(id, "channel.updated", {})

    // Notify mentioned users async
    if (mentions.length > 0) {
      notifyMentions(svc, id, channel.name, email, nameByEmail[email] || email, content.trim(), mentions)
        .catch(console.error)
    }

    // Notify all other members of new message (unread tracking)
    notifyMembers(svc, id, channel.name, email, content.trim(), memberEmails)
      .catch(console.error)

    // Handle @ai
    if (isAiCommand && question) {
      if (process.env.ANTHROPIC_API_KEY) {
        handleAiResponse(svc, id, question).catch(console.error)
      } else {
        const aiMessage = await svc.createMktMessages({
          channel_id: id,
          author_id: "ai",
          content: "⚠️ Tính năng @ai chưa bật (thiếu ANTHROPIC_API_KEY).",
          msg_type: "ai_response",
          reactions: {},
          mentions: [],
        })
        broadcastToChannel(id, "message.created", { message: formatMktMessage(aiMessage, nameByEmail) })
        broadcastToChannel(id, "channel.updated", {})
      }
    }

    res.json({ message })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// Gửi system notification cho members khi có tin mới (dùng Medusa notification module nếu có)
async function notifyMembers(
  svc: any, channelId: string, channelName: string,
  senderEmail: string, preview: string, memberEmails: string[]
) {
  // Lưu vào bảng admin_notification (nếu project có) — best-effort
  try {
    const others = memberEmails.filter(e => e !== senderEmail)
    for (const email of others) {
      await svc.createMktMessages({
        channel_id: "__notify__",
        author_id: "system",
        content: JSON.stringify({ type: "new_message", channel_id: channelId, channel_name: channelName, sender: senderEmail, preview: preview.slice(0, 60), recipient: email }),
        msg_type: "system_notify",
        reactions: {},
        mentions: [],
      }).catch(() => {})
    }
  } catch {}
}

async function notifyMentions(
  svc: any, channelId: string, channelName: string,
  senderEmail: string, senderName: string, content: string, mentions: string[]
) {
  // Post system message với mention info để frontend badge
  const message = await svc.createMktMessages({
    channel_id: channelId,
    author_id: "system",
    content: `${senderName} đã nhắc đến: ${mentions.join(", ")}`,
    msg_type: "mention",
    mentions,
    reactions: {},
  }).catch((e: any) => { console.error(e); return null })
  if (message) {
    broadcastToChannel(channelId, "message.created", { message: formatMktMessage(message, { [senderEmail]: senderName }) })
    broadcastToChannel(channelId, "channel.updated", {})
  }
}

async function handleAiResponse(svc: any, channelId: string, question: string) {
  try {
    const tasks = await svc.listMktTasks({ channel_id: channelId, deleted_at: null })
    const taskSummary = tasks.map((t: any) =>
      `- ${t.title} [${t.type}] → ${t.assignee_id} | ${t.status}${t.deadline ? ` | deadline: ${t.deadline}` : ""}${t.rating ? ` | ★${t.rating}` : ""}`
    ).join("\n")

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: `Bạn là trợ lý quản lý team marketing Phan Viet. Trả lời ngắn gọn bằng tiếng Việt.\nDanh sách task của channel này:\n${taskSummary || "(Chưa có task nào)"}`,
        messages: [{ role: "user", content: question }],
      }),
    })
    const data = await response.json() as any
    const aiText = data.content?.[0]?.text || "Không thể xử lý câu hỏi này."
    const aiMessage = await svc.createMktMessages({
      channel_id: channelId, author_id: "ai", content: aiText,
      msg_type: "ai_response", reactions: {}, mentions: [],
    })
    broadcastToChannel(channelId, "message.created", { message: formatMktMessage(aiMessage) })
    broadcastToChannel(channelId, "channel.updated", {})
  } catch {
    const aiMessage = await svc.createMktMessages({
      channel_id: channelId, author_id: "ai",
      content: "⚠️ AI không thể trả lời lúc này.",
      msg_type: "ai_response", reactions: {}, mentions: [],
    })
    broadcastToChannel(channelId, "message.created", { message: formatMktMessage(aiMessage) })
    broadcastToChannel(channelId, "channel.updated", {})
  }
}
