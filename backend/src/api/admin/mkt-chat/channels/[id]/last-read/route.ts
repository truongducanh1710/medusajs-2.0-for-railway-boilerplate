import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../../../lib/db"
import { ulid } from "ulid"

async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["email"] })
  return user?.email ?? null
}

// PATCH /admin/mkt-chat/channels/:id/last-read
// Đánh dấu user đã đọc đến thời điểm hiện tại trong channel này
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const { id: channelId } = req.params
    const now = new Date().toISOString()

    await getPool().query(
      `INSERT INTO mkt_channel_read (id, channel_id, user_email, last_read_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (channel_id, user_email) DO UPDATE SET last_read_at = $4, updated_at = $6`,
      [ulid(), channelId, email, now, now, now]
    )

    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
