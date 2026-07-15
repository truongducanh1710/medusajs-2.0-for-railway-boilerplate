import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { getMktChatAuthInfo, broadcastPresenceChange } from "../_lib"
import { touchPresenceSession, getLivePresence } from "../_presence"

// GET /admin/mkt-chat/presence — trạng thái live của cả team (chấm xanh/vàng trong chat)
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    res.json({ presence: await getLivePresence() })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/mkt-chat/presence — heartbeat mỗi ~45s từ tab đang mở.
// body: { session_id, active } — active=false khi tab ẩn hoặc không thao tác >5 phút.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const { session_id: sessionId, active } = (req.body || {}) as any
    if (!sessionId) return res.status(400).json({ error: "Thiếu session_id" })

    // Chỉ cho phép touch session của chính mình — chặn giả mạo session_id người khác.
    const { rows } = await getPool().query(
      `SELECT status FROM mkt_presence_session WHERE id = $1 AND user_email = $2 AND ended_at IS NULL`,
      [sessionId, auth.email]
    )
    if (!rows[0]) return res.status(404).json({ error: "Session không tồn tại hoặc đã kết thúc" })

    const isActive = active !== false
    await touchPresenceSession(sessionId, isActive)

    const next = isActive ? "online" : "idle"
    if (rows[0].status !== next) broadcastPresenceChange(auth.email, next)

    res.json({ ok: true, status: next })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
