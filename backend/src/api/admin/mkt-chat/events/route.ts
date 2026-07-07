import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMktChatAuthInfo, listVisibleMktChannelIds, registerMktChatSseClient } from "../_lib"

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

  r.write(`event: connected\ndata: ${JSON.stringify({ channel_ids: channelIds })}\n\n`)

  const unregister = registerMktChatSseClient(r, auth.email, channelIds)

  const keepalive = setInterval(() => {
    try { r.write(": keepalive\n\n") } catch { clearInterval(keepalive); unregister() }
  }, 25000)

  req.on("close", () => { clearInterval(keepalive); unregister() })
}

export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  return res.status(405).json({ error: "Method not allowed" })
}
