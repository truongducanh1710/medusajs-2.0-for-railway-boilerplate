import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// GET /admin/mkt-chat/channels/:id/stream - SSE for real-time messages
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const uid = (req as any).auth_context?.actor_id
  if (!uid) return res.status(401).json({ error: "Unauthenticated" })

  const svc = req.scope.resolve("mktTaskModule") as any
  const { id: channelId } = req.params

  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.setHeader("X-Accel-Buffering", "no")
  res.flushHeaders()

  // Track last message time
  let lastCheck = new Date()
  let lastMessageId: string | null = null

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  sendEvent({ type: "connected", channel_id: channelId })

  // Poll every 3 seconds for new messages
  const interval = setInterval(async () => {
    try {
      const newMessages = await svc.listMktMessages(
        { channel_id: channelId, deleted_at: null, created_at: { $gt: lastCheck } },
        { order: { created_at: "ASC" } }
      )
      if (newMessages.length > 0) {
        lastCheck = new Date()
        for (const msg of newMessages) {
          sendEvent({ type: "message", message: msg })
        }
      }
    } catch {
      // Channel may be gone, stop streaming
      clearInterval(interval)
      res.end()
    }
  }, 3000)

  // Cleanup on client disconnect
  req.on("close", () => {
    clearInterval(interval)
    res.end()
  })
}
