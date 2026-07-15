import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMktChatAuthInfo, listVisibleMktChannelIds, registerMktChatSseClient, broadcastPresenceChange, hasOtherSseConnection } from "../_lib"
import { startPresenceSession, endPresenceSession } from "../_presence"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getMktChatAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })

  const channelIds = await listVisibleMktChannelIds(req, auth)
  const r = res as any
  r.setHeader("Content-Type", "text/event-stream")
  r.setHeader("Cache-Control", "no-cache")
  r.setHeader("Connection", "keep-alive")
  r.setHeader("X-Accel-Buffering", "no")
  r.flushHeaders?.()

  // Tab mở = 1 presence session. Client gửi session_id kèm heartbeat để cộng dồn active/idle.
  const sessionId = await startPresenceSession(auth.email, req.headers["user-agent"] as string)
  broadcastPresenceChange(auth.email, "online")

  r.write(`event: connected\ndata: ${JSON.stringify({ channel_ids: channelIds, session_id: sessionId })}\n\n`)

  const unregister = registerMktChatSseClient(r, auth.email, channelIds)

  const keepalive = setInterval(() => {
    try { r.write(": keepalive\n\n") } catch { clearInterval(keepalive); unregister() }
  }, 25000)

  req.on("close", () => {
    clearInterval(keepalive)
    unregister() // chạy trước khi đếm — client đang đóng đã bị loại khỏi set
    endPresenceSession(sessionId)
      .then(() => {
        if (!hasOtherSseConnection(auth.email)) broadcastPresenceChange(auth.email, "offline")
      })
      .catch(() => {})
  })
}

export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  return res.status(405).json({ error: "Method not allowed" })
}
