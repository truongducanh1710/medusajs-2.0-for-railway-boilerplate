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

// POST /admin/mkt-chat/channels/:id/typing
// Client ping mỗi ~2.5s khi đang gõ; presence trả về trong GET messages
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const { id: channelId } = req.params
    const now = new Date().toISOString()

    // Insert với last_read_at = epoch để không vô tình mark-read; update chỉ đụng typing_at
    await getPool().query(
      `INSERT INTO mkt_channel_read (id, channel_id, user_email, last_read_at, typing_at, created_at, updated_at)
       VALUES ($1, $2, $3, '1970-01-01T00:00:00Z', $4, $4, $4)
       ON CONFLICT (channel_id, user_email) DO UPDATE SET typing_at = $4, updated_at = $4`,
      [ulid(), channelId, email, now]
    )

    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
