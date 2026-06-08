import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { broadcastChatEvent, getChatAuthInfo, registerSseClient } from "../_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getChatAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })

  const r = res as any
  r.setHeader("Content-Type", "text/event-stream")
  r.setHeader("Cache-Control", "no-cache")
  r.setHeader("Connection", "keep-alive")
  r.setHeader("X-Accel-Buffering", "no")
  r.flushHeaders?.()

  r.write("event: connected\ndata: {}\n\n")

  const unregister = registerSseClient(r, auth.fbPageIds)

  // Keepalive mỗi 25s để tránh Railway/nginx timeout
  const keepalive = setInterval(() => {
    try { r.write(": keepalive\n\n") } catch { clearInterval(keepalive); unregister() }
  }, 25000)

  req.on("close", () => { clearInterval(keepalive); unregister() })
}

// Export placeholder để Medusa nhận diện file là route
export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  return res.status(405).json({ error: "Method not allowed" })
}
