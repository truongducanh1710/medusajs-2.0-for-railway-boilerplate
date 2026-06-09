import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../../../lib/db"

async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["email"] })
  return user?.email ?? null
}

// GET /admin/mkt-chat/channels/:id/search?q=keyword
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const { id: channelId } = req.params
    const { q } = req.query as any
    if (!q?.trim()) return res.json({ messages: [] })

    const svc = req.scope.resolve("mktTaskModule") as any
    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    const superEmail = process.env.SUPER_ADMIN_EMAIL
    const memberCheck = email === superEmail || (Array.isArray(channel.members) && channel.members.some((m: any) => m.user_id === email))
    if (!memberCheck) return res.status(403).json({ error: "Bạn không phải thành viên của channel này" })

    // Full text search với ILIKE (đơn giản, hiệu quả với vài ngàn tin nhắn)
    const result = await getPool().query(
      `SELECT id, author_id, content, msg_type, file_url, file_name, reply_to_id, is_pinned, reactions, mentions, created_at
       FROM mkt_message
       WHERE channel_id = $1
         AND deleted_at IS NULL
         AND content ILIKE $2
         AND msg_type NOT IN ('system','system_notify','mention')
       ORDER BY created_at DESC
       LIMIT 30`,
      [channelId, `%${q.trim()}%`]
    )

    const userModule = req.scope.resolve(Modules.USER)
    const allUsers = await userModule.listUsers({}, { select: ["email", "first_name", "last_name"] })
    const nameByEmail: Record<string, string> = {}
    for (const u of allUsers) nameByEmail[u.email] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email

    const messages = result.rows.map((m: any) => ({
      ...m,
      author_name: m.author_id === "ai" ? "AI Assistant" : (nameByEmail[m.author_id] || m.author_id),
    }))

    res.json({ messages })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
