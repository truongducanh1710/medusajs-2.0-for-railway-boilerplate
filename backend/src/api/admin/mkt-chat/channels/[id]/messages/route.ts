import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../../../lib/db"
import { broadcastToChannel, canAccessMktChannel, canPostInMktChannel, createMentionNotifications, formatMktMessage, getMktChatAuthInfo, getMktUserNameMap } from "../../../_lib"
import { ADS_EXPENSE_CHANNEL_NAME, parseAdsExpenseText } from "../../../_ads-expense-parser"

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
  if (/(^|[\s.,!?;:()\[\]{}])@all(?=$|[\s.,!?;:()\[\]{}])/i.test(normalizedContent)) {
    return memberEmails
  }

  // Chỉ khớp @mention CHÍNH XÁC theo token (email / localpart / tên có gạch nối).
  // KHÔNG dùng substring/fuzzy match — nó bắn thông báo sai khi tin nhắn chứa
  // email người khác, URL, hay @ai... dù không hề tag ai. Nguồn chính xác về
  // người được tag là mảng `mentions` explicit do client (mention-picker) gửi lên.
  for (const email of memberEmails) {
    const name = nameByEmail[email] || ""
    const candidates = [
      email,
      email.split("@")[0],
      name.replace(/\s+/g, "_"),
    ]
      .map(normalizeMentionText)
      .filter(candidate => candidate && candidate !== "ai" && candidate.length >= 2)

    if (candidates.some(candidate =>
      new RegExp(`(^|[\\s.,!?;:()\\[\\]{}])@${escapeRegExp(candidate)}(?=$|[\\s.,!?;:()\\[\\]{}])`).test(normalizedContent)
    )) {
      mentioned.add(email)
    }
  }

  return [...mentioned]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeExplicitMentions(input: any, memberEmails: string[]): string[] {
  if (!Array.isArray(input)) return []
  const memberSet = new Set(memberEmails)
  return [...new Set(input.map(email => String(email || "").trim()).filter(email => memberSet.has(email)))]
}
async function resolveReplyRoot(channelId: string, replyToId?: string | null) {
  if (!replyToId) return null
  const result = await getPool().query(
    `SELECT id, reply_to_id, author_id, content, msg_type
     FROM mkt_message
     WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
    [replyToId, channelId]
  )
  const parent = result.rows[0]
  if (!parent) return { error: "Khong tim thay tin nhan can tra loi" }
  const rootId = parent.reply_to_id || parent.id
  if (rootId === parent.id) return { rootId, root: parent }

  const rootResult = await getPool().query(
    `SELECT id, reply_to_id, author_id, content, msg_type
     FROM mkt_message
     WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
    [rootId, channelId]
  )
  return { rootId, root: rootResult.rows[0] || parent }
}

// GET /admin/mkt-chat/channels/:id/messages
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const email = auth.email

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { before, limit = "50" } = req.query as any

    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Khong tim thay channel" })

    if (!canAccessMktChannel(channel, auth)) {
      return res.status(403).json({ error: "Ban khong phai thanh vien cua channel nay" })
    }

    const filter: any = { channel_id: id, deleted_at: null }
    if (before) filter.created_at = { $lt: new Date(before) }

    const messages = await svc.listMktMessages(filter, {
      order: { created_at: "DESC" },
      take: Math.min(Number(limit), 100),
    })

    const nameByEmail = await getMktUserNameMap(req)
    const replyIds = [...new Set(messages.map((m: any) => m.reply_to_id).filter(Boolean))]
    const replyMap: Record<string, any> = {}
    if (replyIds.length > 0) {
      const replies = await svc.listMktMessages({ id: { $in: replyIds } }, { select: ["id", "content", "author_id", "msg_type"] })
      for (const r of replies) {
        replyMap[r.id] = {
          id: r.id,
          content: String(r.content || "").slice(0, 80),
          author_name: r.author_id === "ai" ? "AI Assistant" : (nameByEmail[r.author_id] || r.author_id),
        }
      }
    }

    const enriched = messages.reverse().map((m: any) => formatMktMessage(m, nameByEmail, m.reply_to_id ? replyMap[m.reply_to_id] : null))

    let online: string[] = []
    let typing: string[] = []
    try {
      const memberEmails: string[] = Array.isArray(channel.members) ? channel.members.map((m: any) => m.user_id) : []
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
    } catch { /* best-effort */ }

    res.json({ messages: enriched, presence: { online, typing } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/mkt-chat/channels/:id/messages
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const email = auth.email

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { content, reply_to_id, msg_type } = req.body as any
    const text = String(content || "").trim()
    if (!text) return res.status(400).json({ error: "Noi dung khong duoc rong" })
    const messageType = msg_type === "internal_note" ? "internal_note" : "text"

    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Khong tim thay channel" })

    if (!canAccessMktChannel(channel, auth)) {
      return res.status(403).json({ error: "Ban khong phai thanh vien cua channel nay" })
    }
    if (messageType === "text" && !canPostInMktChannel(channel, auth)) {
      return res.status(403).json({ error: "Chi quan tri vien duoc dang bai trong channel thong bao nay" })
    }

    const nameByEmail = await getMktUserNameMap(req)
    const memberEmails: string[] = Array.isArray(channel.members) ? channel.members.map((m: any) => m.user_id) : []
    const explicitMentions = normalizeExplicitMentions((req.body as any)?.mentions, memberEmails)
    const mentions = [...new Set([...explicitMentions, ...parseMentions(text, memberEmails, nameByEmail)])].filter(mentionEmail => mentionEmail !== email)
    const isAiCommand = messageType === "text" && text.toLowerCase().startsWith("@ai ")
    const question = isAiCommand ? text.slice(4).trim() : ""

    const resolvedReply = await resolveReplyRoot(id, reply_to_id)
    if ((resolvedReply as any)?.error) return res.status(400).json({ error: (resolvedReply as any).error })
    const rootReplyId = (resolvedReply as any)?.rootId || null
    const rootReply = (resolvedReply as any)?.root || null

    const message = await svc.createMktMessages({
      channel_id: id,
      author_id: email,
      content: text,
      msg_type: messageType,
      reply_to_id: rootReplyId,
      reactions: {},
      mentions,
      reply_count: 0,
    })

    let rootReplyCount: number | null = null
    if (rootReplyId) {
      const updated = await getPool().query(
        `UPDATE mkt_message SET reply_count = COALESCE(reply_count, 0) + 1, updated_at = now()
         WHERE id = $1 RETURNING reply_count`,
        [rootReplyId]
      )
      rootReplyCount = Number(updated.rows[0]?.reply_count || 0)
    }

    const replySnippet = rootReply ? {
      id: rootReply.id,
      content: String(rootReply.content || "").slice(0, 80),
      author_name: rootReply.author_id === "ai" ? "AI Assistant" : (nameByEmail[rootReply.author_id] || rootReply.author_id),
    } : null
    const formattedMessage = formatMktMessage(message, nameByEmail, replySnippet)

    if (messageType === "text" && channel.name === ADS_EXPENSE_CHANNEL_NAME) {
      const parsed = parseAdsExpenseText(text)
      if (parsed) {
        svc.createAdsExpenseTransactions({
          source_message_id: message.id,
          channel_id: id,
          card_last4: parsed.card_last4,
          merchant: parsed.merchant,
          amount: parsed.amount,
          currency: parsed.currency,
          txn_at: parsed.txn_at,
          raw_text: parsed.raw_text,
          parsed_by: "regex",
        }).catch(console.error)
      }
    }

    broadcastToChannel(id, "message.created", { message: formattedMessage })
    if (rootReplyId) {
      broadcastToChannel(id, "thread.reply.created", {
        root_message_id: rootReplyId,
        root_reply_count: rootReplyCount,
        reply: formattedMessage,
      })
    }
    broadcastToChannel(id, "channel.updated", {})

    if (mentions.length > 0) {
      const senderName = nameByEmail[email] || email
      createMentionNotifications(svc, {
        channelId: id,
        channelName: channel.name,
        senderEmail: email,
        senderName,
        messageId: message.id,
        preview: text,
        mentions,
        source: rootReplyId ? "thread" : "message",
      }, req.scope.resolve(Modules.USER)).catch(console.error)
    }
    // Nhánh @ai cũ (Claude Haiku single-shot, không tool) đã bị thay bằng ai-agent
    // service riêng (Railway, tool-calling + permission thật) — service đó tự poll
    // mention/@ai qua /admin/mkt-chat/notifications và tự trả lời. Giữ nguyên
    // ANTHROPIC_AI_LEGACY_ENABLE="1" làm lối thoát khẩn cấp nếu ai-agent service sập.
    if (isAiCommand && question && process.env.ANTHROPIC_AI_LEGACY_ENABLE === "1") {
      if (process.env.ANTHROPIC_API_KEY) {
        handleAiResponse(svc, id, question).catch(console.error)
      } else {
        const aiMessage = await svc.createMktMessages({
          channel_id: id,
          author_id: "ai",
          content: "Tinh nang @ai chua bat (thieu ANTHROPIC_API_KEY).",
          msg_type: "ai_response",
          reactions: {},
          mentions: [],
          reply_count: 0,
        })
        broadcastToChannel(id, "message.created", { message: formatMktMessage(aiMessage, nameByEmail) })
        broadcastToChannel(id, "channel.updated", {})
      }
    }

    res.json({ message: formattedMessage })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

async function handleAiResponse(svc: any, channelId: string, question: string) {
  try {
    const tasks = await svc.listMktTasks({ channel_id: channelId, deleted_at: null })
    const taskSummary = tasks.map((t: any) =>
      `- ${t.title} [${t.type}] -> ${t.assignee_id} | ${t.status}${t.deadline ? ` | deadline: ${t.deadline}` : ""}${t.rating ? ` | rating:${t.rating}` : ""}`
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
        system: `Ban la tro ly quan ly team marketing Phan Viet. Tra loi ngan gon bang tieng Viet.\nDanh sach task cua channel nay:\n${taskSummary || "(Chua co task nao)"}`,
        messages: [{ role: "user", content: question }],
      }),
    })
    const data = await response.json() as any
    const aiText = data.content?.[0]?.text || "Khong the xu ly cau hoi nay."
    const aiMessage = await svc.createMktMessages({
      channel_id: channelId, author_id: "ai", content: aiText,
      msg_type: "ai_response", reactions: {}, mentions: [], reply_count: 0,
    })
    broadcastToChannel(channelId, "message.created", { message: formatMktMessage(aiMessage) })
    broadcastToChannel(channelId, "channel.updated", {})
  } catch {
    const aiMessage = await svc.createMktMessages({
      channel_id: channelId, author_id: "ai",
      content: "AI khong the tra loi luc nay.",
      msg_type: "ai_response", reactions: {}, mentions: [], reply_count: 0,
    })
    broadcastToChannel(channelId, "message.created", { message: formatMktMessage(aiMessage) })
    broadcastToChannel(channelId, "channel.updated", {})
  }
}
