import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { generateAiReplyDryRun } from "../ai-reply"
import { ensureAgentForPage, ensureChatTables, getChatAuthInfo, getChatPool } from "../_lib"

/**
 * Sandbox test bot — chạy generateAiReply ở chế độ dry-run:
 * tool read-only (get_product_info, get_purchase_history) chạy thật,
 * nhưng KHÔNG gửi tin thật, KHÔNG ghi vào fb_conversation/fb_message,
 * action (handoff) chỉ hiển thị để debug, không execute.
 *
 * Body: { page_id, page_name?, messages: [{role:'customer'|'bot', text}], text }
 * `messages` là lịch sử hội thoại giả lập trong sandbox (không phải history thật);
 * `text` là tin nhắn mới nhất của khách trong lượt test này.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const body = (req.body as any) || {}
    const { page_id, page_name, text } = body
    const history = Array.isArray(body.messages) ? body.messages : []
    if (!page_id || !text) return res.status(400).json({ error: "page_id and text required" })

    const pool = getChatPool()
    await ensureChatTables(pool)
    const agent = await ensureAgentForPage(pool, String(page_id), page_name)

    const result = await generateAiReplyDryRun({
      pool,
      scope: req.scope,
      agent,
      history: history
        .filter((m: any) => m?.text)
        .map((m: any) => ({ role: m.role === "bot" ? "bot" : "customer", text: String(m.text) })),
      latestText: String(text),
    })

    return res.json({
      dry_run: true,
      bubbles: result?.bubbles || [],
      actions: result?.actions || [],
      tool_calls: result?.toolCalls || [],
      usage: result?.usage || null,
      agent,
      mode: agent.mode,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
