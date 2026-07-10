import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../../../../../lib/db"
import { broadcastToChannel, createMentionNotifications, formatMktMessage, getMktChatAuthInfo, getMktUserNameMap, canAccessMktChannel } from "../../../../../_lib"

function normalizeMentionText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
}

function parseMentions(content: string, memberEmails: string[], nameByEmail: Record<string, string>): string[] {
  const mentioned = new Set<string>()
  const normalizedContent = normalizeMentionText(content)
  const tokenMatches = content.match(/@[^\s,;:]+/g) || []
  if (/(^|[\s.,!?;:()\[\]{}])@all(?=$|[\s.,!?;:()\[\]{}])/i.test(normalizedContent)) {
    return memberEmails
  }

  for (const email of memberEmails) {
    const name = nameByEmail[email] || ""
    const candidates = [
      email,
      email.split("@")[0],
      name,
      name.replace(/\s+/g, "_"),
    ]
      .map(normalizeMentionText)
      .filter(candidate => candidate && candidate !== "ai")

    if (candidates.some(candidate => normalizedContent.includes(`@${candidate}`))) {
      mentioned.add(email)
      continue
    }

    for (const match of tokenMatches) {
      const token = normalizeMentionText(match.slice(1))
      if (!token || token === "ai" || token.length < 2) continue
      if (candidates.some(candidate => candidate.includes(token) || token.includes(candidate))) {
        mentioned.add(email)
        break
      }
    }
  }

  return [...mentioned]
}

function normalizeExplicitMentions(input: any, memberEmails: string[]): string[] {
  if (!Array.isArray(input)) return []
  const memberSet = new Set(memberEmails)
  return [...new Set(input.map(email => String(email || "").trim()).filter(email => memberSet.has(email)))]
}
async function requireChannelAccess(req: MedusaRequest, channelId: string) {
  const auth = await getMktChatAuthInfo(req)
  if (!auth) return { status: 401, body: { error: "Unauthenticated" } }
  const svc = req.scope.resolve("mktTaskModule") as any
  const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
  if (!channel) return { status: 404, body: { error: "Khong tim thay channel" } }
  if (!canAccessMktChannel(channel, auth)) {
    return { status: 403, body: { error: "Ban khong phai thanh vien cua channel nay" } }
  }
  return { auth, channel, svc }
}

async function resolveRoot(channelId: string, msgId: string) {
  const pool = getPool()
  const start = await pool.query(
    `SELECT id, channel_id, author_id, content, msg_type, reply_to_id, reply_count,
            file_url, file_name, is_pinned, reactions, mentions, created_at
     FROM mkt_message
     WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
    [msgId, channelId]
  )
  const message = start.rows[0]
  if (!message) return null
  const rootId = message.reply_to_id || message.id
  if (rootId === message.id) return message

  const root = await pool.query(
    `SELECT id, channel_id, author_id, content, msg_type, reply_to_id, reply_count,
            file_url, file_name, is_pinned, reactions, mentions, created_at
     FROM mkt_message
     WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
    [rootId, channelId]
  )
  return root.rows[0] || message
}

// GET /admin/mkt-chat/channels/:id/messages/:msgId/thread
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id: channelId, msgId } = req.params
    const access = await requireChannelAccess(req, channelId)
    if ((access as any).status) return res.status((access as any).status).json((access as any).body)

    const root = await resolveRoot(channelId, msgId)
    if (!root) return res.status(404).json({ error: "Khong tim thay tin nhan" })

    const replies = await getPool().query(
      `SELECT id, channel_id, author_id, content, msg_type, reply_to_id, reply_count,
              file_url, file_name, is_pinned, reactions, mentions, created_at
       FROM mkt_message
       WHERE channel_id = $1 AND reply_to_id = $2 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [channelId, root.id]
    )
    const nameByEmail = await getMktUserNameMap(req)
    const rootMessage = formatMktMessage(root, nameByEmail)
    res.json({
      root: rootMessage,
      replies: replies.rows.map((reply: any) => formatMktMessage(reply, nameByEmail, {
        id: root.id,
        content: String(root.content || "").slice(0, 80),
        author_name: rootMessage.author_name,
      })),
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/mkt-chat/channels/:id/messages/:msgId/thread
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id: channelId, msgId } = req.params
    const access = await requireChannelAccess(req, channelId)
    if ((access as any).status) return res.status((access as any).status).json((access as any).body)
    const { auth, channel, svc } = access as any

    const text = String((req.body as any)?.content || "").trim()
    if (!text) return res.status(400).json({ error: "Noi dung khong duoc rong" })

    const root = await resolveRoot(channelId, msgId)
    if (!root) return res.status(404).json({ error: "Khong tim thay tin nhan goc" })

    const nameByEmail = await getMktUserNameMap(req)
    const memberEmails: string[] = Array.isArray(channel.members) ? channel.members.map((m: any) => m.user_id) : []
    const explicitMentions = normalizeExplicitMentions((req.body as any)?.mentions, memberEmails)
    const mentions = [...new Set([...explicitMentions, ...parseMentions(text, memberEmails, nameByEmail)])].filter(mentionEmail => mentionEmail !== auth.email)

    const reply = await svc.createMktMessages({
      channel_id: channelId,
      author_id: auth.email,
      content: text,
      msg_type: "text",
      reply_to_id: root.id,
      reactions: {},
      mentions,
      reply_count: 0,
    })

    const updated = await getPool().query(
      `UPDATE mkt_message SET reply_count = COALESCE(reply_count, 0) + 1, updated_at = now()
       WHERE id = $1 RETURNING reply_count`,
      [root.id]
    )
    const rootReplyCount = Number(updated.rows[0]?.reply_count || 0)
    const formattedReply = formatMktMessage(reply, nameByEmail, {
      id: root.id,
      content: String(root.content || "").slice(0, 80),
      author_name: root.author_id === "ai" ? "AI Assistant" : (nameByEmail[root.author_id] || root.author_id),
    })

    if (mentions.length > 0) {
      createMentionNotifications(svc, {
        channelId,
        channelName: channel.name,
        senderEmail: auth.email,
        senderName: nameByEmail[auth.email] || auth.email,
        messageId: reply.id,
        preview: text,
        mentions,
        source: "thread",
      }).catch(console.error)
    }

    // Không broadcast "message.created" ở đây: reply thread không phải tin nhắn độc lập trong
    // luồng chat chính, chỉ cần "thread.reply.created" để cập nhật reply_count + refresh Thread Panel.
    broadcastToChannel(channelId, "thread.reply.created", {
      root_message_id: root.id,
      root_reply_count: rootReplyCount,
      reply: formattedReply,
    })
    broadcastToChannel(channelId, "channel.updated", {})

    res.json({ reply: formattedReply, root_reply_count: rootReplyCount })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
