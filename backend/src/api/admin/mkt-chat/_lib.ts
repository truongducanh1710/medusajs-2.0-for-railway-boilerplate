import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

type SseClient = {
  res: any
  email: string
  channelIds: Set<string>
}

const _sseClients = new Set<SseClient>()

export type MktChatAuthInfo = {
  email: string
  isSuper: boolean
  isManager: boolean
}

export function isMktChannelMember(channel: any, email: string, isSuper = false): boolean {
  if (isSuper) return true
  return Array.isArray(channel?.members) && channel.members.some((m: any) => m.user_id === email)
}

export async function getMktChatAuthInfo(req: MedusaRequest): Promise<MktChatAuthInfo | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null

  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["email", "metadata"] })
  const email = user?.email || ""
  if (!email) return null

  const isSuper = email === process.env.SUPER_ADMIN_EMAIL
  const perms: string[] = Array.isArray((user.metadata as any)?.permissions)
    ? (user.metadata as any).permissions
    : []

  return {
    email,
    isSuper,
    isManager: isSuper || perms.includes("page.mkt-chat.manage"),
  }
}

export async function listVisibleMktChannelIds(req: MedusaRequest, auth: MktChatAuthInfo): Promise<string[]> {
  const svc = req.scope.resolve("mktTaskModule") as any
  const allChannels = await svc.listMktChannels({ deleted_at: null })
  return allChannels
    .filter((c: any) => auth.isManager || isMktChannelMember(c, auth.email, auth.isSuper))
    .map((c: any) => c.id)
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

export function formatMktMessage(message: any, nameByEmail: Record<string, string> = {}, replyTo?: any) {
  return {
    ...message,
    author_name: message.author_id === "ai"
      ? "AI Assistant"
      : message.author_id === "system"
        ? "System"
        : (nameByEmail[message.author_id] || message.author_id),
    reply_to: replyTo || null,
  }
}
