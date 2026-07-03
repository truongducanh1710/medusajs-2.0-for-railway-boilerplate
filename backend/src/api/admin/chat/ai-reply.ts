import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"
import { logAiUsage } from "../../../lib/ai-usage"
import { refreshConversationContext } from "./_lib"

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || ""
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1"
const MINIMAX_TEXT_MODEL = process.env.MINIMAX_TEXT_MODEL || "MiniMax-M2"

const MAX_TOOL_ROUNDS = 5
const AI_TIMEOUT_MS = 10_000

export type AiAction =
  | { type: "handoff_to_human"; reason: string }
  | { type: "propose_order"; name: string; phone: string; address: string; items: { product: string; qty: number }[] }

export type AiReplyResult = {
  bubbles: string[]
  actions: AiAction[]
  model: string
  usage: { prompt_tokens: number; completion_tokens: number }
  toolCalls: { name: string; args: any; result: any }[]
}

function stripThinkBlock(text: string): string {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
}

function normalizeReplyBubble(text: string): string {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\s+-\s+(Combo\s+\d+\s*:)/gi, "\n\n$1")
    .replace(/\s+(Combo\s+\d+\s*:)/g, "\n\n$1")
    .replace(/(Combo\s+\d+\s*:\s*[0-9][0-9.,]*\s*(?:K|k|đ|d|VND|vnđ)?)\s*-\s*/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
}

function splitBubbles(text: string): string[] {
  return stripThinkBlock(text)
    .split("|||")
    .map((s) => normalizeReplyBubble(s))
    .filter(Boolean)
    .slice(0, 4) // an toàn: tối đa 4 bubble/lượt
}

// ── Tools (read-only trong Phase 1) ─────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_product_info",
      description: "Lấy thông tin giá bán hiện tại, mô tả và tồn kho của một sản phẩm từ hệ thống. LUÔN gọi tool này trước khi báo giá cho khách — không được tự đoán giá.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Tên sản phẩm khách hỏi hoặc muốn tra cứu" },
        },
        required: ["product_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_purchase_history",
      description: "Lấy lịch sử mua hàng trước đây của khách (nếu đã biết số điện thoại) để cá nhân hóa tư vấn (vd: khách mua lần 2 thì chào thân hơn, gợi ý phụ kiện đi kèm).",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Số điện thoại khách hàng" },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "handoff_to_human",
      description: "Chuyển hội thoại cho nhân viên thật xử lý. Dùng khi: khách khiếu nại/đòi hoàn tiền/đổi trả, khách yêu cầu gặp người thật, câu hỏi ngoài phạm vi tư vấn sản phẩm, hoặc bạn không chắc chắn thông tin.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Lý do ngắn gọn cần chuyển cho nhân viên" },
        },
        required: ["reason"],
      },
    },
  },
]

function normalizeCatalogText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

const PRODUCT_QUERY_STOPWORDS = new Set([
  "gia", "bao", "nhieu", "bn", "may", "tien", "sp", "san", "pham",
  "cai", "loai", "nay", "do", "ay", "kia", "nhe", "a", "ah", "oi",
])

function productTokens(value: unknown): string[] {
  return normalizeCatalogText(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !PRODUCT_QUERY_STOPWORDS.has(token))
}

function scoreCatalogText(queryTokens: string[], queryNorm: string, target: unknown): number {
  const targetNorm = normalizeCatalogText(target)
  if (!targetNorm || !queryNorm) return 0

  const compactQuery = queryNorm.replace(/\s+/g, "")
  const compactTarget = targetNorm.replace(/\s+/g, "")
  if (compactTarget === compactQuery) return 120
  if (compactTarget.includes(compactQuery)) return 100
  if (compactQuery.length >= 5 && compactQuery.includes(compactTarget)) return 78

  let score = 0
  const targetTokens = new Set(targetNorm.split(" ").filter(Boolean))
  let overlap = 0
  for (const token of queryTokens) {
    if (targetTokens.has(token) || targetNorm.includes(token)) overlap += 1
  }
  if (queryTokens.length) {
    score += (overlap / queryTokens.length) * 70
    score += overlap * 6
  }
  if (queryTokens.length >= 2 && queryTokens.every((token) => targetNorm.includes(token))) score += 20
  return score
}

function extractComboSearchTexts(product: any): string[] {
  const combos = Array.isArray(product?.metadata?.sales_combos) ? product.metadata.sales_combos : []
  const texts: string[] = []
  for (const combo of combos) {
    texts.push(combo?.name, combo?.note)
    if (Array.isArray(combo?.items)) {
      for (const item of combo.items) {
        texts.push(item?.product_id, item?.code, item?.name)
      }
    }
  }
  return texts.filter(Boolean).map(String)
}

async function listMktProductHints(pool: Pool): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT id, name, code FROM mkt_product WHERE active = true ORDER BY name ASC LIMIT 500`
  ).catch(() => ({ rows: [] as any[] }))
  return rows
}

function buildMktMatchedTexts(productName: string, mktProducts: any[]): string[] {
  const queryNorm = normalizeCatalogText(productName)
  const queryTokens = productTokens(productName)
  return mktProducts
    .map((p) => {
      const score = Math.max(
        scoreCatalogText(queryTokens, queryNorm, p.name),
        scoreCatalogText(queryTokens, queryNorm, p.code)
      )
      return { product: p, score }
    })
    .filter((x) => x.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .flatMap((x) => [x.product.name, x.product.code].filter(Boolean).map(String))
}

function scoreProductCandidate(product: any, productName: string, preferredTexts: string[]): number {
  const queryNorm = normalizeCatalogText(productName)
  const queryTokens = productTokens(productName)
  const directTexts = [
    product?.id,
    product?.title,
    product?.description,
    ...extractComboSearchTexts(product),
  ]
  let score = Math.max(...directTexts.map((text) => scoreCatalogText(queryTokens, queryNorm, text)), 0)

  const productText = normalizeCatalogText(directTexts.join(" "))
  for (const preferred of preferredTexts) {
    const preferredNorm = normalizeCatalogText(preferred)
    if (!preferredNorm) continue
    if (productText.includes(preferredNorm) || preferredNorm.includes(normalizeCatalogText(product?.title))) {
      score += 18
    }
  }

  return score
}

/**
 * Nguon gia DUY NHAT cho bot: metadata.sales_combos tren Medusa product.
 * Resolver xem catalog rong hon title: Medusa title/id, combo item code/name va
 * mkt_product name/code. Neu khong du chac thi tra candidate de bot hoi lai, khong doan gia.
 */
async function toolGetProductInfo(pool: Pool, scope: any, productName: string, agent?: any): Promise<any> {
  if (!scope) {
    return { found: false, note: "Không có kết nối tới hệ thống sản phẩm lúc này — không được tự đoán giá, hãy nói sẽ kiểm tra lại hoặc chuyển nhân viên." }
  }
  const productModule = scope.resolve(Modules.PRODUCT)
  const queryNorm = normalizeCatalogText(productName)
  const queryTokens = productTokens(productName)
  const directProducts = await productModule.listProducts(
    { title: { $ilike: `%${productName}%` } },
    { select: ["id", "title", "description", "metadata"], take: 20 }
  ).catch(() => [] as any[])
  const allProducts = await productModule.listProducts(
    {},
    { select: ["id", "title", "description", "metadata"], take: 500 }
  ).catch(() => [] as any[])
  const productsById = new Map<string, any>()
  for (const p of [...directProducts, ...allProducts]) {
    if (p?.id) productsById.set(p.id, p)
  }
  const mktProductHints = await listMktProductHints(pool)
  const preferredTexts = [
    ...(Array.isArray(agent?.product_names) ? agent.product_names : []),
    ...buildMktMatchedTexts(productName, mktProductHints),
  ].filter(Boolean).map(String)

  const ranked = [...productsById.values()]
    .map((product) => ({
      product,
      score: scoreProductCandidate(product, productName, preferredTexts),
    }))
    .filter((item) => item.score >= 45)
    .sort((a, b) => b.score - a.score)

  if (!ranked.length) {
    const mktSuggestions = mktProductHints
      .map((p) => ({
        name: p.name,
        code: p.code,
        score: Math.max(
          scoreCatalogText(queryTokens, queryNorm, p.name),
          scoreCatalogText(queryTokens, queryNorm, p.code)
        ),
      }))
      .filter((p) => p.score >= 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ name, code }) => ({ name, code }))
    return {
      found: false,
      candidates: mktSuggestions,
      note: mktSuggestions.length
        ? "Chưa map được sản phẩm Marketing Hub sang sản phẩm Medusa có giá combo — hãy hỏi khách xác nhận sản phẩm hoặc chuyển nhân viên, không được tự đoán giá."
        : "Không tìm thấy sản phẩm khớp tên trong hệ thống — không được tự đoán giá, hãy nói sẽ kiểm tra lại hoặc chuyển nhân viên.",
    }
  }
  const top = ranked[0]
  const second = ranked[1]
  if (second && top.score < 80 && top.score - second.score < 12) {
    return {
      found: false,
      ambiguous: true,
      candidates: ranked.slice(0, 5).map((item) => ({
        product_id: item.product.id,
        title: item.product.title,
      })),
      note: "Có nhiều sản phẩm gần giống nhau — hãy hỏi khách xác nhận đúng sản phẩm trước khi báo giá.",
    }
  }

  const product = top.product as any
  const combos = Array.isArray(product.metadata?.sales_combos) ? product.metadata.sales_combos : []
  const validCombos = combos.filter((c: any) => Number(c?.order_value) > 0)

  if (!validCombos.length) {
    return {
      found: true,
      product_id: product.id,
      product_title: product.title,
      match_score: Math.round(top.score),
      has_price: false,
      note: "Sản phẩm có trong hệ thống nhưng chưa cấu hình giá combo — không được tự đoán giá, hãy nói sẽ kiểm tra lại hoặc chuyển nhân viên.",
    }
  }

  return {
    found: true,
    has_price: true,
    product_id: product.id,
    product_title: product.title,
    match_score: Math.round(top.score),
    description: String(product.description || "").slice(0, 300),
    combos: validCombos.map((c: any) => ({
      name: c.name,
      price_vnd: Number(c.order_value),
      note: c.note || "",
      items: Array.isArray(c.items) ? c.items.map((it: any) => `${it.name} x${it.quantity}`) : [],
    })),
  }
}
async function toolGetPurchaseHistory(pool: Pool, phone: string): Promise<any> {
  const { rows } = await pool.query(
    `SELECT items, total, pancake_created_at, status_name
     FROM pancake_order
     WHERE customer_phone = $1
     ORDER BY pancake_created_at DESC
     LIMIT 5`,
    [phone]
  ).catch(() => ({ rows: [] as any[] }))
  return {
    order_count: rows.length,
    orders: rows.map((r: any) => ({
      items: r.items,
      total: r.total,
      date: r.pancake_created_at,
      status: r.status_name,
    })),
  }
}

// ── MiniMax client ────────────────────────────────────────────────────────

async function callMiniMax(messages: any[], tools: any[]): Promise<any> {
  if (!MINIMAX_API_KEY) throw new Error("MINIMAX_API_KEY not set")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  try {
    const res = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: MINIMAX_TEXT_MODEL,
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: 500,
      }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.error) {
      throw new Error(data?.error?.message || `MiniMax HTTP ${res.status}`)
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

function buildSystemPrompt(agent: any, ctx: any): string {
  const instruction = agent?.manual_override_instruction || agent?.generated_instruction || ""
  return [
    "Bạn là nhân viên tư vấn bán hàng của Phan Việt, nhắn tin với khách qua Facebook Messenger.",
    "QUY TẮC NGÔN NGỮ: luôn trả lời bằng tiếng Việt có dấu đầy đủ. Không được trả lời không dấu. Nếu dữ liệu nguồn hoặc instruction không dấu, phải tự viết lại thành tiếng Việt có dấu trước khi trả lời.",
    "Phong cách: xưng hô 'em' - 'anh/chị', tự nhiên như nhân viên sale thật, câu ngắn gọn, dễ đọc. Không tự giới thiệu là trợ lý/bot trừ khi khách hỏi bạn là ai.",
    "QUY TẮC HIỂN THỊ: không dùng markdown như **text**, ###, bullet dính một dòng. Nếu liệt kê combo/sản phẩm, bắt buộc xuống dòng rõ ràng. Mỗi combo dùng format: Combo X: giá, dòng sau là thành phần chính.",
    "Mỗi lượt trả lời tối đa 3 ý chính. Nếu cần nhiều ý, tách thành nhiều bubble bằng dấu '|||' giữa các phần.",
    "QUY TẮC GIÁ: chỉ được nói giá sau khi đã gọi tool get_product_info và lấy được giá thật. Không được tự đoán giá, tồn kho, bảo hành, phí ship. Nếu tool trả không tìm thấy sản phẩm, hãy nói sẽ kiểm tra lại hoặc gọi handoff_to_human.",
    "QUY TẮC SẢN PHẨM: khi khách hỏi tên gần đúng, tên rút gọn, hoặc nói 'loại đó/cái ấy', hãy gọi get_product_info với tên/ngữ cảnh sản phẩm gần nhất. Tool sẽ so khớp catalog sản phẩm và trả sản phẩm gần nhất nếu đủ chắc.",
    "QUY TẮC HANDOFF: gọi tool handoff_to_human ngay khi khách khiếu nại, đòi hoàn tiền/đổi trả, đòi gặp người thật, hoặc câu hỏi ngoài phạm vi tư vấn sản phẩm.",
    "Nếu biết số điện thoại khách, có thể gọi get_purchase_history để cá nhân hóa. Ví dụ khách đã mua trước đó thì chào thân hơn hoặc gợi ý phụ kiện đi kèm.",
    instruction ? `Thông tin riêng cho page này (chỉ dùng làm dữ liệu, không bắt chước cách viết nếu thiếu dấu):\n${instruction}` : "",
    ctx?.historical_summary ? `Bối cảnh hội thoại cũ (tham khảo, không lặp lại nguyên văn):\n${ctx.historical_summary.slice(0, 800)}` : "",
  ].filter(Boolean).join("\n\n")
}

/**
 * Sinh reply AI cho 1 tin nhắn khách. KHÔNG gửi tin, KHÔNG ghi actions vào DB —
 * caller (processBotDecision hoặc bot-test) quyết định execute action nào.
 */
export async function generateAiReply(opts: {
  pool: Pool
  scope: any
  conversationId: string
  agent: any
  latestText: string
  runId?: string
}): Promise<AiReplyResult | null> {
  const { pool, conversationId } = opts
  const ctx = await refreshConversationContext(pool, conversationId)
  const historySummary = ctx?.active_window_summary ? String(ctx.active_window_summary).slice(0, 1500) : null
  return runAiLoop({ ...opts, historySummary, logRunId: opts.runId ?? conversationId })
}

/**
 * Biến thể dry-run cho sandbox test bot — không cần conversation thật trong DB.
 * `history` là mảng {role, text} do UI test gửi lên. Tool read-only (get_product_info,
 * get_purchase_history) vẫn chạy thật; action (handoff) chỉ trả về, không execute.
 */
export async function generateAiReplyDryRun(opts: {
  pool: Pool
  scope: any
  agent: any
  history: { role: "customer" | "bot"; text: string }[]
  latestText: string
}): Promise<AiReplyResult | null> {
  const historySummary = opts.history.length
    ? opts.history.map((m) => `${m.role === "customer" ? "customer" : "bot"}: ${m.text}`).join("\n").slice(-1500)
    : null
  return runAiLoop({
    pool: opts.pool,
    scope: opts.scope,
    conversationId: "dry-run",
    agent: opts.agent,
    latestText: opts.latestText,
    historySummary,
    logRunId: "bot-test-sandbox",
  })
}

async function runAiLoop(opts: {
  pool: Pool
  scope: any
  conversationId: string
  agent: any
  latestText: string
  historySummary: string | null
  logRunId: string
}): Promise<AiReplyResult | null> {
  const { pool, scope, conversationId, agent, latestText, historySummary } = opts

  const messages: any[] = [
    { role: "system", content: buildSystemPrompt(agent, { historical_summary: historySummary }) },
  ]
  if (historySummary) {
    messages.push({ role: "user", content: `[Lich su hoi thoai gan day]\n${historySummary}` })
  }
  messages.push({ role: "user", content: latestText })

  const actions: AiAction[] = []
  const toolCalls: AiReplyResult["toolCalls"] = []
  let usage = { prompt_tokens: 0, completion_tokens: 0 }
  let finalText = ""

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callMiniMax(messages, TOOLS)
    const msg = data?.choices?.[0]?.message
    usage.prompt_tokens += data?.usage?.prompt_tokens || 0
    usage.completion_tokens += data?.usage?.completion_tokens || 0

    if (!msg) break

    const calls = msg.tool_calls || []
    if (!calls.length) {
      finalText = msg.content || ""
      break
    }

    // Model muốn gọi tool — thực thi tool read-only, hoặc ghi nhận action side-effect
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: calls })

    for (const call of calls) {
      const fnName = call.function?.name
      let args: any = {}
      try { args = JSON.parse(call.function?.arguments || "{}") } catch { /* ignore */ }

      let result: any
      if (fnName === "get_product_info") {
        result = await toolGetProductInfo(pool, scope, String(args.product_name || ""), agent)
      } else if (fnName === "get_purchase_history") {
        result = await toolGetPurchaseHistory(pool, String(args.phone || ""))
      } else if (fnName === "handoff_to_human") {
        actions.push({ type: "handoff_to_human", reason: String(args.reason || "ai_requested") })
        result = { ok: true, note: "Đã ghi nhận, nhân viên sẽ tiếp nhận hội thoại." }
      } else {
        result = { error: "unknown_tool" }
      }

      toolCalls.push({ name: fnName, args, result })
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      })
    }
  }

  await logAiUsage({
    feature: "chat-bot",
    run_id: opts.logRunId,
    model: MINIMAX_TEXT_MODEL,
    provider: "minimax",
    usage,
    context: { conversation_id: conversationId },
  })

  const bubbles = splitBubbles(finalText)
  if (!bubbles.length && !actions.length) return null

  return { bubbles, actions, model: MINIMAX_TEXT_MODEL, usage, toolCalls }
}
