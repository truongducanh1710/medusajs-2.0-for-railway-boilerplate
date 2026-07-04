import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureAgentForPage, ensureChatTables, getChatAuthInfo, getChatPool } from "../../../_lib"
import { generateAiReplyDryRun } from "../../../ai-reply"

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || ""
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1"
const MINIMAX_TEXT_MODEL = process.env.MINIMAX_TEXT_MODEL || "MiniMax-M2"
const LOOP_TIMEOUT_MS = 30_000

function splitProductNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean)
  return String(value || "").split(",").map((x) => x.trim()).filter(Boolean)
}

function getLoopProductNames(agent: any): string[] {
  return [
    ...splitProductNames(agent?.product_names),
    ...splitProductNames(agent?.sp_chay),
  ].filter((name, idx, arr) => name && arr.indexOf(name) === idx)
}

function getPrimaryProductLabel(agent: any): string {
  return getLoopProductNames(agent)[0] || "sản phẩm gia dụng đang chạy trên page"
}

function buildDefaultScenarios(agent: any): string[] {
  const product = getPrimaryProductLabel(agent)
  return [
    `Dạ ${product} giá sao em?`,
    `Nhà chị 4 người thì nên lấy combo ${product} nào?`,
    `${product} có bảo hành không em?`,
  ]
}

function buildDryRunHistory(agent: any, customerText: string): { role: "customer" | "bot"; text: string }[] {
  const product = getPrimaryProductLabel(agent)
  if (product === "sản phẩm gia dụng đang chạy trên page") return []
  const text = String(customerText || "").toLowerCase()
  const isGeneric = /\bsản phẩm này\b|\bloại này\b|\bcái này\b|\bcombo nào\b|\bbảo hành\b/.test(text)
  if (!isGeneric) return []
  return [{ role: "customer", text: `Em đang quan tâm ${product}.` }]
}

function buildLoopFallbackReply(agent: any, customerText: string): string {
  const product = getPrimaryProductLabel(agent)
  const text = String(customerText || "").toLowerCase()
  if (/bảo hành|bao hanh/.test(text)) {
    return `Dạ ${product} bên em có hỗ trợ sau mua ạ.\n\nĐể báo đúng chính sách bảo hành theo sản phẩm, em kiểm tra lại thông tin trên hệ thống rồi tư vấn chính xác cho anh/chị nhé.\n\nAnh/chị đang quan tâm combo nào ạ?`
  }
  if (/uy tín|uy tin|lừa|lua|thật không|that khong|shop/.test(text)) {
    return `Dạ shop bên em có hỗ trợ tư vấn và chăm sóc sau mua ạ.\n\nAnh/chị có thể cho em biết mình đang quan tâm ${product} để em gửi đúng thông tin sản phẩm, giá và chính sách hỗ trợ nhé.`
  }
  if (/giá|gia|bao nhiêu|bao nhieu|combo/.test(text)) {
    return `Dạ em đang kiểm tra giá và combo của ${product} cho anh/chị ạ.\n\nAnh/chị dùng cho gia đình mấy người để em tư vấn combo phù hợp hơn nhé?`
  }
  return `Dạ em đang tư vấn ${product} ạ.\n\nAnh/chị muốn hỏi giá, combo hay chính sách bảo hành để em hỗ trợ đúng nhất nhé?`
}

async function hydrateLoopAgent(pool: any, agent: any): Promise<any> {
  if (getLoopProductNames(agent).length) return agent
  const found = await pool.query(
    `SELECT sp_chay
     FROM mkt_page
     WHERE lower(trim(page_name)) = lower(trim($1))
        OR page_link ILIKE $2
     LIMIT 1`,
    [agent.page_name || "", `%${agent.page_id || ""}%`]
  ).catch(() => ({ rows: [] as any[] }))
  const spChay = found.rows[0]?.sp_chay
  if (!spChay) return agent
  return { ...agent, sp_chay: spChay, product_names: splitProductNames(spChay) }
}

async function callMiniMax(messages: any[], maxTokens = 1200): Promise<string> {
  if (!MINIMAX_API_KEY) throw new Error("MINIMAX_API_KEY not set")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LOOP_TIMEOUT_MS)
  try {
    const r = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MINIMAX_API_KEY}` },
      body: JSON.stringify({ model: MINIMAX_TEXT_MODEL, messages, max_tokens: maxTokens }),
      signal: controller.signal,
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || data?.error) throw new Error(data?.error?.message || `MiniMax HTTP ${r.status}`)
    return data?.choices?.[0]?.message?.content || ""
  } finally {
    clearTimeout(timeout)
  }
}

function stripThinkBlock(text: string): string {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
}

function parseJsonObject(text: string): any {
  const raw = stripThinkBlock(text).replace(/```json|```/g, "").trim()
  try { return JSON.parse(raw) } catch { /* continue */ }
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

function parseJsonArray(text: string): any[] | null {
  const raw = stripThinkBlock(text).replace(/```json|```/g, "").trim()
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null } catch { /* continue */ }
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return null
  try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : null } catch { return null }
}

async function simulateCustomers(agent: any, count: number): Promise<string[]> {
  const productHint = getLoopProductNames(agent).length ? getLoopProductNames(agent).join(", ") : "sản phẩm gia dụng đang chạy trên page"
  const raw = await callMiniMax([
    { role: "system", content: "Bạn đóng vai khách hàng Việt Nam nhắn Facebook Messenger. Chỉ trả JSON array string, không giải thích." },
    { role: "user", content: `Tạo ${count} câu khách hàng tự nhiên, ngắn, có dấu, xoay quanh: ${productHint}. Bao gồm hỏi giá, hỏi combo/phù hợp gia đình, và bảo hành/niềm tin. Trả đúng JSON array.` },
  ], 500)
  const arr = parseJsonArray(raw)
  return (arr || buildDefaultScenarios(agent)).map((x) => String(x)).filter(Boolean).slice(0, count)
}

async function evaluateReply(customerText: string, botReply: string, toolCalls: any[]): Promise<any> {
  let raw = ""
  let callError: string | null = null
  try {
    raw = await callMiniMax([
      { role: "system", content: "Bạn là QA evaluator cho bot bán hàng Messenger. Chấm nghiêm, trả JSON object." },
      { role: "user", content: `Rubric 0-10: tiếng Việt có dấu, dễ đọc, không markdown thô, không bịa giá/tồn kho/phí ship, dùng giá từ tool nếu có, hỏi tiếp hợp lý, không quá dài, đúng xưng hô em-anh/chị.\n\nKhách: ${customerText}\n\nBot: ${botReply}\n\nTool calls: ${JSON.stringify(toolCalls).slice(0, 2000)}\n\nTrả JSON: {"score": number, "issues": string[], "strengths": string[], "verdict": string}` },
    ], 1200)
  } catch (err: any) {
    callError = err?.message ? String(err.message) : "evaluator call failed"
  }
  const parsed = parseJsonObject(raw)
  // parsed === null nghĩa là evaluator lỗi/không trả JSON hợp lệ — KHÔNG phải bot chấm 0 điểm thật.
  // Phân biệt rõ để không hiểu nhầm "lỗi kỹ thuật" thành "bot trả lời tệ".
  if (parsed === null) {
    return { score: 0, issues: [], strengths: [], verdict: "", eval_failed: true, eval_error: callError || "evaluator did not return valid JSON" }
  }
  const score = Math.max(0, Math.min(10, Number(parsed.score) || 0))
  return { score, issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [], strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [], verdict: String(parsed.verdict || ""), eval_failed: false }
}

async function improvePrompt(agent: any, currentInstruction: string, evals: any[]): Promise<{ prompt_text: string; change_reason: string }> {
  const raw = await callMiniMax([
    { role: "system", content: "Bạn là prompt engineer cho bot sale Phan Việt. Chỉ sửa instruction riêng của page, không viết lại system prompt. Trả JSON object." },
    { role: "user", content: `Instruction hiện tại:\n${currentInstruction || "(trống)"}\n\nKết quả test:\n${JSON.stringify(evals, null, 2).slice(0, 6000)}\n\nHãy tạo instruction riêng cho page tốt hơn. Yêu cầu: tiếng Việt có dấu, dễ đọc trên Messenger, không markdown, không cho bot bịa giá, giữ handoff khi không chắc, chỉ bổ sung tone/format/page context. Trả JSON {"prompt_text":"...", "change_reason":"..."}` },
  ], 1200)
  const parsed = parseJsonObject(raw) || {}
  const promptText = String(parsed.prompt_text || currentInstruction || "").trim()
  return {
    prompt_text: promptText.slice(0, 6000),
    change_reason: String(parsed.change_reason || "AI đề xuất cải thiện prompt sau vòng test tự động.").slice(0, 1000),
  }
}

function averageScore(evals: any[]): number {
  if (!evals.length) return 0
  return Math.round((evals.reduce((sum, e) => sum + (Number(e.evaluation?.score) || 0), 0) / evals.length) * 10) / 10
}

async function runScenarioSet(pool: any, scope: any, agent: any, scenarios: string[]) {
  const results = []
  for (const customer of scenarios) {
    let reply: Awaited<ReturnType<typeof generateAiReplyDryRun>> = null
    let error: string | null = null
    try {
      reply = await generateAiReplyDryRun({
        pool,
        scope,
        agent,
        history: buildDryRunHistory(agent, customer),
        latestText: customer,
      })
    } catch (err: any) {
      error = err?.message ? String(err.message) : "generateAiReplyDryRun failed"
    }
    const aiText = (reply?.bubbles || []).join("\n").trim()
    const fallbackUsed = !aiText
    const botText = fallbackUsed ? buildLoopFallbackReply(agent, customer) : aiText
    const evaluation = await evaluateReply(customer, botText, reply?.toolCalls || [])
    results.push({
      customer,
      bot_reply: botText,
      ai_reply_empty: fallbackUsed,
      fallback_used: fallbackUsed,
      error,
      tool_calls: reply?.toolCalls || [],
      evaluation,
    })
  }
  return results
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const body = (req.body as any) || {}
    const scenarioCount = Math.max(1, Math.min(4, Number(body.scenario_count || 3)))
    const pool = getChatPool()
    await ensureChatTables(pool)

    const cur = await pool.query(`SELECT * FROM fb_bot_agent WHERE id = $1`, [id])
    let agent = cur.rows[0]
    if (!agent) return res.status(404).json({ error: "Agent not found" })
    if (auth.fbPageIds && !auth.fbPageIds.includes(agent.page_id)) return res.status(403).json({ error: "Forbidden" })
    agent = await hydrateLoopAgent(pool, await ensureAgentForPage(pool, agent.page_id, agent.page_name))

    const scenarios = Array.isArray(body.scenarios) && body.scenarios.length
      ? body.scenarios.map((s: any) => String(s)).filter(Boolean).slice(0, scenarioCount)
      : await simulateCustomers(agent, scenarioCount)

    const currentInstruction = String(agent.manual_override_instruction || agent.generated_instruction || "")
    const before = await runScenarioSet(pool, req.scope, agent, scenarios)
    const improvement = await improvePrompt(agent, currentInstruction, before)
    const draftAgent = { ...agent, manual_override_instruction: improvement.prompt_text }
    const after = await runScenarioSet(pool, req.scope, draftAgent, scenarios)
    const scoreBefore = averageScore(before)
    const scoreAfter = averageScore(after)
    const summaryIssues = after.flatMap((r: any) => r.evaluation?.issues || []).slice(0, 8)
    const evalFailedCount = [...before, ...after].filter((r: any) => r.evaluation?.eval_failed).length
    const evalSummary = evalFailedCount > 0
      ? `⚠ Evaluator lỗi ${evalFailedCount}/${before.length + after.length} lần — điểm số KHÔNG đáng tin, không phản ánh chất lượng bot thật. Xem lại tool_calls/error trước khi duyệt draft này.`
      : `Before: ${scoreBefore}/10. After draft: ${scoreAfter}/10. ${summaryIssues.length ? `Còn lưu ý: ${summaryIssues.join("; ")}` : "Draft đạt rubric tốt hơn hoặc tương đương."}`

    const next = await pool.query(`SELECT COALESCE(MAX(version), 0) + 1 AS version FROM fb_bot_prompt_version WHERE agent_id = $1`, [id])
    const saved = await pool.query(
      `INSERT INTO fb_bot_prompt_version
        (agent_id, page_id, version, prompt_text, change_reason, score_before, score_after, eval_summary, scenarios, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft','ai')
       RETURNING *`,
      [id, agent.page_id, next.rows[0].version, improvement.prompt_text, improvement.change_reason, scoreBefore, scoreAfter, evalSummary, JSON.stringify({ scenarios, before, after })]
    )

    await pool.query(`UPDATE fb_bot_agent SET prompt_score = $1, last_eval_at = now(), updated_at = now() WHERE id = $2`, [scoreAfter, id])

    return res.json({ ok: true, version: saved.rows[0], scenarios, before, after, score_before: scoreBefore, score_after: scoreAfter, eval_summary: evalSummary })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
