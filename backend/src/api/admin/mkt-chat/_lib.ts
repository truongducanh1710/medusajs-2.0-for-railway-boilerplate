import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { ROLE_PRESETS } from "../../../admin/lib/permissions"
import { getPool } from "../../../lib/db"

type SseClient = {
  res: any
  email: string
  channelIds: Set<string>
}

const _sseClients = new Set<SseClient>()

export type MktChatAuthInfo = {
  email: string
  isSuper: boolean
  isAdmin: boolean
  isManager: boolean
}

export type MktMessageSearchOptions = {
  q: string
  visibleChannelIds: string[]
  channelId?: string
  authorId?: string
  from?: string
  to?: string
  limit?: number
}

export function isMktChannelMember(channel: any, email: string, isSuper = false): boolean {
  if (isSuper) return true
  return Array.isArray(channel?.members) && channel.members.some((m: any) => m.user_id === email)
}

export function canAccessMktChannel(channel: any, auth: MktChatAuthInfo): boolean {
  return auth.isManager || isMktChannelMember(channel, auth.email, auth.isSuper)
}

export async function getMktChatAuthInfo(req: MedusaRequest): Promise<MktChatAuthInfo | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null

  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["email", "metadata"] })
  const email = user?.email || ""
  if (!email) return null

  const role = (user.metadata as any)?.role ?? ""
  const isSuper = email === process.env.SUPER_ADMIN_EMAIL
  const isAdmin = isSuper || role === "admin"
  const perms = resolveMktUserPerms(user.metadata)

  return {
    email,
    isSuper,
    isAdmin,
    isManager: isAdmin || perms.includes("page.mkt-chat.manage"),
  }
}

export async function listVisibleMktChannelIds(req: MedusaRequest, auth: MktChatAuthInfo): Promise<string[]> {
  const svc = req.scope.resolve("mktTaskModule") as any
  const allChannels = await svc.listMktChannels({ deleted_at: null })
  return allChannels
    .filter((c: any) => canAccessMktChannel(c, auth))
    .map((c: any) => c.id)
}

export async function getMktUserNameMap(req: MedusaRequest): Promise<Record<string, string>> {
  const userModule = req.scope.resolve(Modules.USER)
  const allUsers = await userModule.listUsers({}, { select: ["email", "first_name", "last_name"] })
  const nameByEmail: Record<string, string> = {}
  for (const u of allUsers) {
    nameByEmail[u.email] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
  }
  return nameByEmail
}

export function registerMktChatSseClient(res: any, email: string, channelIds: string[]): () => void {
  const client: SseClient = { res, email, channelIds: new Set(channelIds) }
  _sseClients.add(client)
  return () => _sseClients.delete(client)
}

export function broadcastToChannel(channelId: string, event: string, data: Record<string, any>) {
  const payload = `event: ${event}\ndata: ${JSON.stringify({ channel_id: channelId, ...data })}\n\n`
  for (const client of _sseClients) {
    if (!client.channelIds.has(channelId)) continue
    try { client.res.write(payload) } catch { _sseClients.delete(client) }
  }
}

export function broadcastToUser(email: string, event: string, data: Record<string, any>) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of _sseClients) {
    if (client.email !== email) continue
    try { client.res.write(payload) } catch { _sseClients.delete(client) }
  }
}

// Cập nhật ngay channelIds của các SSE connection đang mở khi membership channel thay đổi,
// tránh session-stale: user bị remove khỏi private channel vẫn nhận broadcast tới khi F5.
export function syncSseClientChannel(channelId: string, addedEmails: string[], removedEmails: string[]) {
  for (const client of _sseClients) {
    if (addedEmails.includes(client.email)) client.channelIds.add(channelId)
    if (removedEmails.includes(client.email)) client.channelIds.delete(channelId)
  }
}

export function formatMktMessage(message: any, nameByEmail: Record<string, string> = {}, replyTo?: any) {
  return {
    ...message,
    reply_count: Number(message.reply_count || 0),
    author_name: message.author_id === "ai"
      ? "AI Assistant"
      : message.author_id === "system"
        ? "System"
        : (nameByEmail[message.author_id] || message.author_id),
    reply_to: replyTo || null,
  }
}

export function resolveMktUserPerms(metadata: any): string[] {
  const explicit: string[] = Array.isArray(metadata?.permissions) ? metadata.permissions : []
  const role: string = metadata?.role ?? ""
  const fromRole: string[] = role && ROLE_PRESETS[role] ? (ROLE_PRESETS[role] as string[]) : []
  return [...new Set([...fromRole, ...explicit])]
}
export type CreateMentionNotificationOptions = {
  channelId: string
  channelName: string
  senderEmail: string
  senderName: string
  messageId: string
  preview: string
  mentions: string[]
  source?: "message" | "thread"
}

export async function createMentionNotifications(svc: any, opts: CreateMentionNotificationOptions) {
  const recipients = [...new Set((opts.mentions || []).filter(email => email && email !== opts.senderEmail))]
  if (recipients.length === 0) return

  for (const recipient of recipients) {
    const createdAt = new Date().toISOString()
    const payload = {
      type: "mention",
      recipient,
      channel_id: opts.channelId,
      channel_name: opts.channelName,
      message_id: opts.messageId,
      sender: opts.senderEmail,
      sender_name: opts.senderName,
      preview: String(opts.preview || "").slice(0, 160),
      source: opts.source || "message",
      created_at: createdAt,
    }

    const notification = await svc.createMktMessages({
      channel_id: "__notify__",
      author_id: "system",
      content: JSON.stringify(payload),
      msg_type: "system_notify",
      reactions: {},
      mentions: [],
      reply_count: 0,
    }).catch(() => null)

    if (notification?.id) {
      broadcastToUser(recipient, "mention.notification.created", {
        notification: {
          id: notification.id,
          ...payload,
          created_at: notification.created_at || createdAt,
        },
      })
    }
  }
}

export async function searchMktMessages(req: MedusaRequest, opts: MktMessageSearchOptions) {
  const q = opts.q.trim()
  if (!q || opts.visibleChannelIds.length === 0) return []

  const params: any[] = [`%${q}%`, opts.visibleChannelIds]
  const where = [
    `m.channel_id = ANY($2::text[])`,
    `m.deleted_at IS NULL`,
    `m.content ILIKE $1`,
    `m.msg_type NOT IN ('system', 'system_notify', 'mention')`,
  ]

  if (opts.channelId) {
    if (!opts.visibleChannelIds.includes(opts.channelId)) return []
    params.push(opts.channelId)
    where.push(`m.channel_id = $${params.length}`)
  }
  if (opts.authorId) {
    params.push(opts.authorId)
    where.push(`m.author_id = $${params.length}`)
  }
  if (opts.from) {
    params.push(opts.from)
    where.push(`m.created_at >= $${params.length}`)
  }
  if (opts.to) {
    params.push(opts.to)
    where.push(`m.created_at <= $${params.length}`)
  }

  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 50)
  params.push(limit)

  const result = await getPool().query(
    `SELECT m.id, m.channel_id, m.author_id, m.content, m.msg_type, m.file_url, m.file_name,
            m.reply_to_id, m.reply_count, m.is_pinned, m.reactions, m.mentions, m.created_at,
            c.name AS channel_name
     FROM mkt_message m
     LEFT JOIN mkt_channel c ON c.id = m.channel_id
     WHERE ${where.join(" AND ")}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params
  )

  const nameByEmail = await getMktUserNameMap(req)
  return result.rows.map((m: any) => formatMktMessage(m, nameByEmail))
}