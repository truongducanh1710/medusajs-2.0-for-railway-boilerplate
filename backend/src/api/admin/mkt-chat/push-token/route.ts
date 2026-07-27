import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getMktChatAuthInfo } from "../_lib"

// POST /admin/mkt-chat/push-token — mobile app registers its Expo push token
// here right after login (and again whenever Expo issues a new token). Stored
// on the user's own metadata, same pattern as metadata.tg_chat_id for Telegram.
// body: { token: string }
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const { token } = (req.body || {}) as { token?: string }
    if (!token || typeof token !== "string" || !token.startsWith("ExponentPushToken")) {
      return res.status(400).json({ error: "Thiếu hoặc sai định dạng Expo push token" })
    }

    const userModule = req.scope.resolve(Modules.USER)
    const actorId = (req as any).auth_context.actor_id
    const user = await userModule.retrieveUser(actorId, { select: ["id", "metadata"] })
    await userModule.updateUsers({
      id: user.id,
      metadata: { ...(user.metadata as any), expo_push_token: token },
    })

    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// DELETE /admin/mkt-chat/push-token — called on logout so a shared/reset
// device stops receiving this user's mention pushes.
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const userModule = req.scope.resolve(Modules.USER)
    const actorId = (req as any).auth_context.actor_id
    const user = await userModule.retrieveUser(actorId, { select: ["id", "metadata"] })
    const metadata = { ...(user.metadata as any) }
    delete metadata.expo_push_token
    await userModule.updateUsers({ id: user.id, metadata })

    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
