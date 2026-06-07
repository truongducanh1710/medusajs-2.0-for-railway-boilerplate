import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { detectHandoff, detectIntent, ensureAgentForPage, ensureChatTables, getChatAuthInfo, getChatPool } from "../_lib"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const { page_id, page_name, text } = (req.body as any) || {}
    if (!page_id || !text) return res.status(400).json({ error: "page_id and text required" })
    const pool = getChatPool()
    await ensureChatTables(pool)
    const agent = await ensureAgentForPage(pool, String(page_id), page_name)
    return res.json({
      intent: detectIntent(String(text)),
      handoff: detectHandoff(String(text)),
      agent,
      mode: agent.mode,
      note: "Bot-test uses the same rule classifier as webhook. Full context requires a real conversation.",
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
