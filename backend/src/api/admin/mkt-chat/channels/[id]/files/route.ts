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

// GET /admin/mkt-chat/channels/:id/files — file/ảnh đã gửi trong channel (context panel)
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params

    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    const superEmail = process.env.SUPER_ADMIN_EMAIL
    const isMember = Array.isArray(channel.members) && channel.members.some((m: any) => m.user_id === email)
    if (email !== superEmail && !isMember) {
      return res.status(403).json({ error: "Bạn không phải thành viên của channel này" })
    }

    const r = await getPool().query(
      `SELECT id, file_url, file_type, file_name, file_expires_at, author_id, created_at
       FROM mkt_message
       WHERE channel_id = $1 AND deleted_at IS NULL AND file_url IS NOT NULL
       ORDER BY created_at DESC LIMIT 50`,
      [id]
    )

    res.json({ files: r.rows })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
