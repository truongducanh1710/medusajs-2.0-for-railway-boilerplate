import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { broadcastToUser, getMktChatAuthInfo, isMktChannelMember } from "../_lib"

// GET /admin/mkt-chat/channels - list visible channels
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const allChannels = await svc.listMktChannels({ deleted_at: null })
    const channels = auth.isManager
      ? allChannels
      : allChannels.filter((c: any) => isMktChannelMember(c, auth.email, auth.isSuper))

    const channelIds = channels.map((c: any) => c.id)
    let lastReadMap: Record<string, string> = {}
    if (channelIds.length > 0) {
      const readRows = await getPool().query(
        `SELECT channel_id, last_read_at FROM mkt_channel_read WHERE user_email = $1 AND channel_id = ANY($2)`,
        [auth.email, channelIds]
      )
      for (const row of readRows.rows) lastReadMap[row.channel_id] = row.last_read_at
    }

    const unreadMap: Record<string, number> = {}
    for (const channelId of channelIds) {
      const lastRead = lastReadMap[channelId]
      const r = await getPool().query(
        `SELECT COUNT(*)::int AS cnt FROM mkt_message
         WHERE channel_id = $1 AND deleted_at IS NULL AND author_id != 'ai'
         ${lastRead ? `AND created_at > $2` : ""}`,
        lastRead ? [channelId, lastRead] : [channelId]
      )
      unreadMap[channelId] = r.rows[0]?.cnt ?? 0
    }

    const mentionUnreadMap: Record<string, number> = {}
    for (const channelId of channelIds) {
      const lastRead = lastReadMap[channelId]
      const r = await getPool().query(
        `SELECT COUNT(*)::int AS cnt FROM mkt_message
         WHERE channel_id = $1 AND deleted_at IS NULL AND mentions ? $2
         ${lastRead ? `AND created_at > $3` : ""}`,
        lastRead ? [channelId, auth.email, lastRead] : [channelId, auth.email]
      )
      mentionUnreadMap[channelId] = r.rows[0]?.cnt ?? 0
    }

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
        is_private: Boolean(c.is_private),
        member_count: Array.isArray(c.members) ? c.members.length : 0,
        member_ids: Array.isArray(c.members) ? c.members.map((m: any) => m.user_id) : [],
        unread_count: unreadMap[c.id] ?? 0,
        mention_count: mentionUnreadMap[c.id] ?? 0,
        created_at: c.created_at,
        last_message: last ? {
          content: last.msg_type === "image" ? "Anh" : last.msg_type === "file" ? "File" : String(last.content || "").slice(0, 60),
          author_id: last.author_id,
          msg_type: last.msg_type,
          created_at: last.created_at,
        } : null,
      }
    })

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

// POST /admin/mkt-chat/channels - manager only
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    if (!auth.isManager) return res.status(403).json({ error: "Chi manager moi duoc tao channel" })

    const { name, description, member_ids, is_private } = req.body as any
    if (!name?.trim()) return res.status(400).json({ error: "Ten channel khong duoc rong" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const memberEmails = Array.isArray(member_ids)
      ? member_ids.filter((email: string) => email && email !== auth.email)
      : []
    const members = [
      { user_id: auth.email, role: "admin", joined_at: new Date().toISOString() },
      ...memberEmails.map((email: string) => ({ user_id: email, role: "member", joined_at: new Date().toISOString() })),
    ]

    const channel = await svc.createMktChannels({
      name: name.trim(),
      description: description || null,
      created_by: auth.email,
      members,
      is_private: Boolean(is_private),
    })

    for (const memberEmail of members.map((m: any) => m.user_id)) {
      broadcastToUser(memberEmail, "channel.member.updated", {
        channel_id: channel.id,
        member_ids: members.map((m: any) => m.user_id),
      })
    }

    res.json({ channel })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}