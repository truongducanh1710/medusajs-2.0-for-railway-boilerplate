import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../lib/db"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

// Identity key trong toàn feature mkt-chat = email (đồng bộ với mkt-tasks & permissions/mkt-users)
async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const uid = actorId(req)
  if (!uid) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email"] })
  return user?.email ?? null
}

async function isManager(req: MedusaRequest): Promise<boolean> {
  const uid = actorId(req)
  if (!uid) return false
  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email", "metadata"] })
  if (user.email === superEmail) return true
  const perms: string[] = Array.isArray((user.metadata as any)?.permissions)
    ? (user.metadata as any).permissions : []
  return perms.includes("page.mkt-chat.manage")
}

// GET /admin/mkt-chat/channels - list channels user is member of
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const manager = await isManager(req)

    const allChannels = await svc.listMktChannels({ deleted_at: null })

    // Filter channels: manager sees all, MKT sees only those they're member of (key = email)
    const channels = manager
      ? allChannels
      : allChannels.filter((c: any) =>
          Array.isArray(c.members) && c.members.some((m: any) => m.user_id === email)
        )

    // Lấy last_read_at của user cho tất cả channels một lần
    const channelIds = channels.map((c: any) => c.id)
    let lastReadMap: Record<string, string> = {}
    if (channelIds.length > 0) {
      const readRows = await getPool().query(
        `SELECT channel_id, last_read_at FROM mkt_channel_read WHERE user_email = $1 AND channel_id = ANY($2)`,
        [email, channelIds]
      )
      for (const row of readRows.rows) lastReadMap[row.channel_id] = row.last_read_at
    }

    // Đếm unread per channel (messages sau last_read_at, không đếm tin AI)
    let unreadMap: Record<string, number> = {}
    for (const channelId of channelIds) {
      const lastRead = lastReadMap[channelId]
      const res2 = await getPool().query(
        `SELECT COUNT(*)::int AS cnt FROM mkt_message
         WHERE channel_id = $1 AND deleted_at IS NULL AND author_id != 'ai'
         ${lastRead ? `AND created_at > $2` : ""}`,
        lastRead ? [channelId, lastRead] : [channelId]
      )
      unreadMap[channelId] = res2.rows[0]?.cnt ?? 0
    }

    // Last message per channel (sidebar snippet) — 1 query DISTINCT ON
    const lastMsgMap: Record<string, any> = {}
    if (channelIds.length > 0) {
      try {
        const lastRows = await getPool().query(
          `SELECT DISTINCT ON (channel_id) channel_id, content, author_id, msg_type, created_at
           FROM mkt_message
           WHERE channel_id = ANY($1) AND deleted_at IS NULL
             AND msg_type IN ('text', 'internal_note', 'image', 'file', 'ai_response')
           ORDER BY channel_id, created_at DESC`,
          [channelIds]
        )
        for (const row of lastRows.rows) lastMsgMap[row.channel_id] = row
      } catch { /* best-effort */ }
    }

    // Presence toàn cục: user có hoạt động trong 2 phút (last-read heartbeat)
    let onlineEmails: string[] = []
    try {
      const onlineRows = await getPool().query(
        `SELECT user_email FROM mkt_channel_read
         GROUP BY user_email
         HAVING MAX(updated_at) > now() - interval '2 minutes'`
      )
      onlineEmails = onlineRows.rows.map((r: any) => r.user_email)
    } catch { /* best-effort */ }

    const enriched = channels.map((c: any) => {
      const last = lastMsgMap[c.id]
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        member_count: Array.isArray(c.members) ? c.members.length : 0,
        member_ids: Array.isArray(c.members) ? c.members.map((m: any) => m.user_id) : [],
        unread_count: unreadMap[c.id] ?? 0,
        created_at: c.created_at,
        last_message: last ? {
          content: last.msg_type === "image" ? "🖼 Hình ảnh" : last.msg_type === "file" ? "📎 File" : String(last.content || "").slice(0, 60),
          author_id: last.author_id,
          msg_type: last.msg_type,
          created_at: last.created_at,
        } : null,
      }
    })

    // Sort: hoạt động gần nhất lên đầu
    enriched.sort((a: any, b: any) => {
      const ta = a.last_message ? new Date(a.last_message.created_at).getTime() : new Date(a.created_at).getTime()
      const tb = b.last_message ? new Date(b.last_message.created_at).getTime() : new Date(b.created_at).getTime()
      return tb - ta
    })

    res.json({ channels: enriched, online_emails: onlineEmails })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/mkt-chat/channels - tạo channel (manager only)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await isManager(req))) return res.status(403).json({ error: "Chỉ manager mới được tạo channel" })

    const { name, description, member_ids } = req.body as any
    if (!name?.trim()) return res.status(400).json({ error: "Tên channel không được rỗng" })

    const svc = req.scope.resolve("mktTaskModule") as any

    // member_ids từ frontend là email. Creator cũng dùng email để đồng nhất key.
    const memberEmails = Array.isArray(member_ids) ? member_ids.filter((e: string) => e && e !== email) : []
    const members = [
      { user_id: email, role: "admin", joined_at: new Date().toISOString() },
      ...memberEmails.map((m: string) => ({
        user_id: m, role: "member", joined_at: new Date().toISOString()
      })),
    ]

    const channel = await svc.createMktChannels({
      name: name.trim(),
      description: description || null,
      created_by: email,
      members,
    })

    res.json({ channel })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
