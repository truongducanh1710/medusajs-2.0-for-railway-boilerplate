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

function splitBubbles(text: string): string[] {
  return stripThinkBlock(text)
    .split("|||")
    .map((s) => s.trim())
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

/**
 * Nguồn giá DUY NHẤT cho bot: metadata.sales_combos trên Medusa product — đây là
 * bảng "Combo đơn" sale/marketing tự điền tay ở /app/san-pham/[id] (tab 🧩 Combo đơn),
 * KHÔNG phải Medusa variant pricing. Match theo tên gần đúng qua title; không match
 * được thì trả not_found — bot không được tự đoán giá.
 */
async function toolGetProductInfo(scope: any, productName: string): Promise<any> {
  if (!scope) {
    return { found: false, note: "Không có kết nối tới hệ thống sản phẩm lúc này — không được tự đoán giá, hãy nói sẽ kiểm tra lại hoặc chuyển nhân viên." }
  }
  const productModule = scope.resolve(Modules.PRODUCT)
  const products = await productModule.listProducts(
    { title: { $ilike: `%${productName}%` } },
    { select: ["id", "title", "description", "metadata"], take: 3 }
  ).catch(() => [] as any[])

  if (!products.length) {
    return { found: false, note: "Không tìm thấy sản phẩm khớp tên trong hệ thống — không được tự đoán giá, hãy nói sẽ kiểm tra lại hoặc chuyển nhân viên." }
  }
  const product = products[0] as any
  const combos = Array.isArray(product.metadata?.sales_combos) ? product.metadata.sales_combos : []
  const validCombos = combos.filter((c: any) => Number(c?.order_value) > 0)

  if (!validCombos.length) {
    return { found: true, product_title: product.title, has_price: false, note: "Sản phẩm có trong hệ thống nhưng chưa cấu hình giá combo — không được tự đoán giá, hãy nói sẽ kiểm tra lại hoặc chuyển nhân viên." }
  }

  return {
    found: true,
    has_price: true,
    product_title: product.title,
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
    "Ban la nhan vien tu van ban hang cua Phan Viet (do gia dung), nhan tin qua Facebook Messenger.",
    "Phong cach: xung ho 'em' - 'anh/chi', tu nhien nhu nguoi that, khong may moc, cau ngan gon.",
    "Moi luot tra loi TOI DA 3 cau, neu can nhieu y hay tach thanh nhieu bubble bang dau '|||' giua cac cau.",
    "QUY TAC GIA: chi duoc noi gia sau khi da goi tool get_product_info va lay duoc gia that. KHONG duoc tu doan gia, ton kho, bao hanh, phi ship. Neu tool tra khong tim thay san pham, hay noi se kiem tra lai hoac goi handoff_to_human.",
    "QUY TAC HANDOFF: goi tool handoff_to_human ngay khi khach khieu nai, doi hoan tien/doi tra, doi gap nguoi that, hoac cau hoi ngoai pham vi tu van san pham.",
    "Neu biet so dien thoai khach, co the goi get_purchase_history de ca nhan hoa (vd: khach da mua truoc do thi chao than hon, goi y phu kien di kem).",
    instruction ? `Thong tin rieng cho page nay:\n${instruction}` : "",
    ctx?.historical_summary ? `Boi canh hoi thoai cu (tham khao, khong lap lai nguyen van):\n${ctx.historical_summary.slice(0, 800)}` : "",
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
        result = await toolGetProductInfo(scope, String(args.product_name || ""))
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
