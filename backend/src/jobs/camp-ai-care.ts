import { MedusaContainer } from "@medusajs/framework"
import OpenAI from "openai"
import { randomUUID } from "crypto"
import { callFbApi } from "../api/admin/pancake-sync/report/camp-control/_lib"

const MODEL = process.env.CAMP_AI_MODEL ?? "deepseek-v4-pro"
const EVALUATOR_MODEL = process.env.CAMP_AI_EVALUATOR_MODEL ?? "google/gemini-3.5-flash"
const DEEPSEEK_DIRECT_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"])

// Nén rows thành pipe-separated text để tiết kiệm token (~10-15x so với JSON)
function compressRows(rows: any[]): string {
  if (!rows.length) return "(0 rows)"
  const keys = Object.keys(rows[0])
  const header = keys.join("|")
  const lines = rows.map(r => keys.map(k => {
    const v = r[k]
    if (v === null || v === undefined) return ""
    if (typeof v === "number") return String(Math.round(Number(v) * 100) / 100)
    const s = String(v)
    return s.length > 80 ? s.slice(0, 77) + "…" : s
  }).join("|"))
  return `${header}\n${lines.join("\n")}\n(${rows.length} rows)`
}

// Whitelist views + bảng agent có quyền query (read-only SELECT)
const ALLOWED_TABLES = new Set([
  "v_camp_dashboard", "v_camp_daily_trend",
  "v_camp_today", "v_camp_history", "v_camp_orders",
  "v_shop_care_daily", "v_camp_care_window",
  "agent_insight", "agent_memory", "agent_camp_recommendation",
  "camp_action_log",
])

// Reject SQL nếu có DDL/DML hoặc reference table ngoài whitelist
function validateSql(sql: string): { ok: boolean; error?: string } {
  const normalized = sql.trim().toLowerCase()
  if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
    return { ok: false, error: "Chỉ cho phép SELECT/WITH query" }
  }
  // Block dangerous keywords
  const blocked = ["insert ", "update ", "delete ", "drop ", "alter ", "truncate ", "create ", "grant ", "--", "/*"]
  for (const kw of blocked) {
    if (normalized.includes(kw)) return { ok: false, error: `Từ khoá cấm: ${kw.trim()}` }
  }
  // Check table refs — match FROM/JOIN <name>
  const tableMatches = [...sql.matchAll(/(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)]
  for (const m of tableMatches) {
    const tbl = m[1].toLowerCase()
    if (!ALLOWED_TABLES.has(tbl)) {
      return { ok: false, error: `Table không trong whitelist: ${tbl}. Allowed: ${[...ALLOWED_TABLES].join(", ")}` }
    }
  }
  return { ok: true }
}

const SYSTEM_PROMPT = `Bạn là AI agent tối ưu quảng cáo Facebook cho shop Phan Viet (đồ gia dụng VN).
Hãy phân tích như một marketer dày dặn kinh nghiệm — nhìn data và ra quyết định.

## 🎯 MỤC TIÊU DUY NHẤT
**care_pct toàn shop hôm nay < 30%** (chi phí ads ≤ 30% doanh thu COD)

## Views chính (ưu tiên dùng)

### v_camp_dashboard — "màn hình marketer", 1 query là đủ context
Mỗi row = 1 camp hôm nay, đầy đủ như bảng UI:
  campaign_id, campaign_name, mkt_name, effective_status (ACTIVE/PAUSED),
  daily_budget, spend_today, spend_budget_pct (% budget đã tiêu, vd 46),
  impressions, clicks, cpm, cpc, ctr_pct,
  cod_orders_today, cod_today, care_today,    ← COD + care HÔM NAY
  care_3d, care_7d, care_14d,                 ← windows để thấy trend
  spend_3d, cod_3d, spend_7d, cod_7d,
  days_running,                               ← số ngày camp đã chạy
  trend (great/ok/improving/worsening/high_care/new_camp/no_data),
  has_orders_today, budget_nearly_exhausted   ← flags nhanh

### v_camp_daily_trend — lịch sử 14 ngày per camp per day
Dùng khi cần drill-down: camp_id, date, spend, cpm, cod_orders, cod_amount, care_pct

### v_shop_care_daily — care toàn shop 45 ngày
date, total_spend, total_cod, care_pct, active_camps, order_count

### agent_insight, agent_memory, agent_camp_recommendation, camp_action_log
Đọc trước khi recommend để biết context lịch sử.

## Công cụ
1. **query_ads_db(sql)** — SELECT trên các views trên
2. **recommend_action(campaign_id, action, reason, confidence, suggested_daily_budget?)**
   - action: pause | set_budget | resume | no_action
3. **save_insight(insight, category, scope?)** — Lưu pattern, category: diagnosis|opportunity|pattern|warning

## Workflow — như marketer ngồi care camp

**Bước 1: Nhìn tổng quan shop**
  SELECT date, care_pct, total_spend, total_cod, order_count FROM v_shop_care_daily
  WHERE date >= CURRENT_DATE - 6 ORDER BY date DESC

**Bước 2: Quét toàn bộ camp hôm nay — 1 query**
  SELECT campaign_id, campaign_name, mkt_name, effective_status,
         daily_budget, spend_today, spend_budget_pct,
         cpm, ctr_pct, cod_orders_today, cod_today, care_today,
         care_3d, care_7d, days_running, trend
  FROM v_camp_dashboard ORDER BY spend_today DESC

**Bước 3: Phân loại và hành động**

🔴 VẤNG ĐỀ — camp ACTIVE, spend cao, care_today hoặc care_3d > 35%:
  → Drill-down: xem v_camp_daily_trend 7 ngày để confirm trend
  → Nếu care_7d cũng cao → recommend pause hoặc set_budget giảm 30-50%
  → Nếu care_3d xấu nhưng care_7d ổn → wait, chỉ flag warning

🟡 CHÚ Ý — camp ACTIVE, spend > 50% budget, COD = 0 hôm nay:
  → Xem care_3d: nếu > 30% → recommend giảm budget hoặc pause
  → Nếu camp mới (days_running < 3) → bình thường, không action

🟢 CƠ HỘI — camp PAUSED, care_7d < 25%, cod_7d > 0:
  → Đây là camp tốt đang dừng → recommend resume
  → Suggested budget = spend_7d / 7 * 1.2 (tăng nhẹ 20%)

⚪ BỎ QUA — no_data, camp < 3 ngày, care_today null và care_3d null

**Bước 4: Đọc insights cũ + memory**
  SELECT insight, category, scope FROM agent_insight WHERE active=true LIMIT 15
  SELECT campaign_id, action, rejection_reason FROM agent_memory
  WHERE last_rejected_at > now() - interval '14 days'

**Bước 5: Recommend + save_insight nếu thấy pattern lặp**

## Quy tắc bất biến
- Reason PHẢI có số (vd "care_3d=42%, spend_today=190k, 0 đơn → campaign đang đốt tiền")
- Không recommend camp < 3 ngày (days_running < 3)
- set_budget chỉ được giảm, không tăng (agent không có quyền scale up)
- resume: suggested_daily_budget PHẢI điền (dùng spend_7d/7 làm base)
- Không action nếu care_today null VÀ care_3d null (không đủ data)

## QUY TẮC TRÁNH SPAM
TRƯỚC recommend_action: query agent_camp_recommendation
  WHERE created_at > now() - interval '24 hours' AND status IN ('pending','approved','auto_executed')
→ Camp đã có rec trong 24h → SKIP (trừ khi run_id khác và bị reject)`

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "query_ads_db",
      description: "Chạy SELECT SQL. Ưu tiên: v_camp_dashboard (1 query = full marketer view), v_camp_daily_trend (drill-down 14d), v_shop_care_daily (shop trend). Cũng có: v_camp_today, v_camp_history, v_camp_care_window, agent_insight, agent_memory, agent_camp_recommendation, camp_action_log.",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "SELECT/WITH query" },
        },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_action",
      description: "Ghi recommendation vào DB. Gọi cho MỖI camp đã phân tích cần action.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
          action: { type: "string", enum: ["pause", "set_budget", "resume", "no_action"] },
          reason: { type: "string", description: "KPI cụ thể từ query + trend + action rõ ràng, < 300 chars" },
          suggested_daily_budget: { type: "number", description: "VND, chỉ khi action=set_budget hoặc resume" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["campaign_id", "action", "reason", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_insight",
      description: "Lưu pattern/insight học được từ data để tái sử dụng. Chỉ lưu khi pattern rõ ràng + có data backing.",
      parameters: {
        type: "object",
        properties: {
          insight: { type: "string", description: "Mô tả pattern, < 500 chars" },
          category: { type: "string", enum: ["diagnosis", "opportunity", "pattern", "warning"] },
          scope: { type: "object", description: "{ mkt?, product?, time_range? }" },
          evidence: { type: "object", description: "{ sample_size, data_points, confidence }" },
        },
        required: ["insight", "category"],
      },
    },
  },
]

const EVALUATOR_SYSTEM_PROMPT = `Bạn là evaluator độc lập kiểm tra chất lượng recommendation của AI agent ads.

Tiêu chí:
1. Reason có chứa KPI số liệu cụ thể (care%, CPM, spend)?
2. Action logic với KPI? (pause camp < 3 ngày = SAI; tăng budget khi care cao = SAI)
3. Confidence phù hợp với độ chắc chắn?
4. Reason ≥ 40 ký tự + rõ ràng?

BẮT BUỘC trả JSON CHÍNH XÁC schema:
{
  "evaluations": [
    { "rec_id": "<uuid gốc>", "pass": true, "notes": "" },
    { "rec_id": "<uuid gốc>", "pass": false, "notes": "Lý do fail ngắn" }
  ]
}
KHÔNG markdown wrap, KHÔNG text ngoài JSON. 1 evaluation cho mỗi rec.`

async function canAutoExecute(campaignId: string, action: string, suggestedBudget: number | undefined, mktName: string, sql: any): Promise<boolean> {
  if (!["pause", "set_budget", "resume"].includes(action)) return false

  if (action === "set_budget" && suggestedBudget != null) {
    const rows = await sql.sql(`SELECT daily_budget FROM mkt_ads_cost WHERE campaign_id = $1 ORDER BY date DESC LIMIT 1`, [campaignId]).catch(() => [])
    if (!rows.length || suggestedBudget >= Number(rows[0].daily_budget)) return false
  }

  const autoUsers = await sql.sql(
    `SELECT metadata->>'mkt_code' as mkt_code FROM "user" WHERE metadata->>'agent_auto' = 'true' AND deleted_at IS NULL`
  ).catch(() => [])
  if (!autoUsers.some((u: any) => u.mkt_code === mktName)) return false

  const pending = await sql.sql(
    `SELECT id FROM camp_schedule WHERE campaign_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
    [campaignId]
  ).catch(() => [])
  if (pending.length > 0) return false

  const recent = await sql.sql(
    `SELECT id FROM camp_action_log WHERE campaign_id = $1 AND source = 'agent' AND created_at > now() - interval '1 hour'`,
    [campaignId]
  ).catch(() => [])
  if (recent.length > 0) return false

  return true
}

export default async function campAiCare(container: MedusaContainer, opts?: { mkt?: string; model?: string }) {
  const logger = container.resolve("logger") as any
  const sql = container.resolve("cskhAnalysisModule") as any

  if (!process.env.OPENROUTER_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    logger?.warn?.("[CampAI] No API key set, skipping")
    return
  }

  const runId = randomUUID()
  const activeModel = opts?.model ?? MODEL

  async function heartbeat(updates: Partial<{ phase: string; iteration: number; last_action: string; recs_so_far: number; tokens_used: number; error: string }>) {
    const fields = Object.keys(updates)
    if (!fields.length) return
    const setClause = fields.map((k, i) => `${k} = $${i + 4}`).join(", ") + ", updated_at = now()"
    const values = fields.map(k => (updates as any)[k])
    await sql.sql(
      `INSERT INTO agent_heartbeat (run_id, model, mkt, ${fields.join(", ")}, updated_at)
       VALUES ($1, $2, $3, ${fields.map((_, i) => `$${i + 4}`).join(", ")}, now())
       ON CONFLICT (run_id) DO UPDATE SET ${setClause}`,
      [runId, activeModel, opts?.mkt ?? null, ...values]
    ).catch(() => {})
  }

  const client = new OpenAI(
    DEEPSEEK_DIRECT_MODELS.has(activeModel)
      ? { baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY ?? "", defaultHeaders: { "X-Title": "PhanViet Camp AI" } }
      : { baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY ?? "", defaultHeaders: { "X-Title": "PhanViet Camp AI" } }
  )
  const today = new Date().toISOString().slice(0, 10)
  logger?.info?.(`[CampAI v2] Run ${runId} started model=${activeModel}`)

  const toolCallLog: any[] = []

  async function handleTool(name: string, args: any): Promise<any> {
    toolCallLog.push({ name, args, ts: Date.now() })

    if (name === "query_ads_db") {
      const validation = validateSql(args.sql ?? "")
      if (!validation.ok) return { error: validation.error }
      try {
        // Inject LIMIT 100 nếu chưa có
        let finalSql = args.sql.trim()
        if (!/limit\s+\d+/i.test(finalSql)) {
          finalSql = finalSql.replace(/;?\s*$/, "") + " LIMIT 100"
        }
        const rows = await sql.sql(finalSql)
        const capped = rows.slice(0, 100)
        return compressRows(capped) + (rows.length > 100 ? "\n[truncated, total=" + rows.length + "]" : "")
      } catch (e: any) {
        return { error: `SQL error: ${e.message?.slice(0, 300)}` }
      }
    }

    if (name === "recommend_action") {
      // Dedup check: skip nếu camp đã có rec pending/approved/auto_executed trong 24h CỦA RUN KHÁC
      const recentRecs = await sql.sql(
        `SELECT id, action, status, run_id, created_at
         FROM agent_camp_recommendation
         WHERE campaign_id = $1
           AND status IN ('pending','approved','auto_executed')
           AND created_at > now() - interval '24 hours'
           AND run_id <> $2
         LIMIT 1`,
        [args.campaign_id, runId]
      ).catch(() => [])
      if (recentRecs.length > 0) {
        const r = recentRecs[0]
        return {
          error: `Camp đã có rec '${r.action}' status='${r.status}' trong 24h (id=${r.id}, run=${r.run_id?.slice(0, 8)}). SKIP để tránh duplicate.`,
          skipped: true,
        }
      }

      // Lookup camp current state từ DB (không cần campMap nữa)
      const campRows = await sql.sql(
        `SELECT campaign_id, campaign_name, mkt_name, effective_status, daily_budget
         FROM mkt_ads_cost WHERE campaign_id = $1 AND deleted_at IS NULL
         ORDER BY date DESC LIMIT 1`,
        [args.campaign_id]
      ).catch(() => [])
      if (!campRows.length) return { error: `campaign_id ${args.campaign_id} không tồn tại` }
      const camp = campRows[0]

      // Validation
      if (!args.reason || args.reason.length < 40) {
        return { error: "Reason quá ngắn (<40 chars). Cần KPI số liệu cụ thể.", retry: true }
      }
      if (!/\d/.test(args.reason)) {
        return { error: "Reason phải chứa ít nhất 1 con số.", retry: true }
      }
      if (args.action === "set_budget") {
        if (!args.suggested_daily_budget || args.suggested_daily_budget < 50000) {
          return { error: "set_budget cần suggested_daily_budget >= 50000 VND.", retry: true }
        }
        if (args.suggested_daily_budget >= Number(camp.daily_budget)) {
          return { error: `Chỉ được giảm budget (hiện tại ${camp.daily_budget}).`, retry: true }
        }
      }
      if (args.action === "resume" && camp.effective_status !== "PAUSED") {
        return { error: `Camp đang ${camp.effective_status}, không thể resume.`, retry: true }
      }

      const oldValue = { status: camp.effective_status, daily_budget: camp.daily_budget }
      const suggestedValue =
        args.action === "set_budget" ? { daily_budget: args.suggested_daily_budget } :
        args.action === "pause" ? { status: "PAUSED" } :
        args.action === "resume" ? { status: "ACTIVE", daily_budget: args.suggested_daily_budget } :
        null

      let status = "pending"
      let fbResp: any = null
      let executedAt: string | null = null

      if (args.action !== "no_action") {
        const doAuto = await canAutoExecute(args.campaign_id, args.action, args.suggested_daily_budget, camp.mkt_name, sql)
        if (doAuto) {
          let fbPath = ""
          if (args.action === "pause") fbPath = `/${args.campaign_id}?status=PAUSED`
          else if (args.action === "resume") fbPath = `/${args.campaign_id}?status=ACTIVE${args.suggested_daily_budget ? `&daily_budget=${Math.round(args.suggested_daily_budget)}` : ""}`
          else if (args.action === "set_budget") fbPath = `/${args.campaign_id}?daily_budget=${Math.round(args.suggested_daily_budget)}`

          fbResp = await callFbApi("POST", fbPath)
          executedAt = new Date().toISOString()
          status = fbResp.ok ? "auto_executed" : "pending"

          if (fbResp.ok) {
            await sql.sql(
              `INSERT INTO camp_action_log (campaign_id, campaign_name, action, old_value, new_value, source, user_email, fb_response, success)
               VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'agent', 'agent@phanviet.vn', $6::jsonb, $7)`,
              [args.campaign_id, camp.campaign_name, args.action,
               JSON.stringify(oldValue), JSON.stringify(suggestedValue ?? {}),
               JSON.stringify(fbResp.data), true]
            ).catch(() => {})
          }
        }
      } else {
        status = "no_action"
      }

      await sql.sql(
        `INSERT INTO agent_camp_recommendation
           (run_id, campaign_id, campaign_name, mkt_name, action, reason, old_value, suggested_value, confidence, status, executed_at, fb_response, agent_model)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13)`,
        [runId, args.campaign_id, camp.campaign_name, camp.mkt_name,
         args.action, args.reason, JSON.stringify(oldValue),
         JSON.stringify(suggestedValue), args.confidence ?? "medium",
         status, executedAt, JSON.stringify(fbResp), activeModel]
      ).catch((e: any) => logger?.error?.("[CampAI] insert rec fail:", e.message))

      return { ok: true, status, campaign_name: camp.campaign_name }
    }

    if (name === "save_insight") {
      if (!args.insight || args.insight.length < 30) {
        return { error: "Insight quá ngắn (<30 chars)." }
      }
      await sql.sql(
        `INSERT INTO agent_insight (insight, category, scope, evidence, agent_model)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
        [args.insight, args.category ?? "pattern",
         JSON.stringify(args.scope ?? {}),
         JSON.stringify(args.evidence ?? {}),
         activeModel]
      ).catch((e: any) => logger?.error?.("[CampAI] save insight fail:", e.message))
      return { ok: true }
    }

    return { error: `Unknown tool: ${name}` }
  }

  const mktCtx = opts?.mkt ? `MKT ${opts.mkt}` : "toàn shop"
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Hôm nay ${today}. Tối ưu ${mktCtx} để đạt mục tiêu care_pct < 30%.

Bắt đầu bằng query v_shop_care_daily 14 ngày để biết shop đang ở đâu.
Sau đó đọc agent_insight để dùng skills cũ.
Diagnose/Opportunity tùy state, recommend actions có reason backed by data, save_insight nếu phát hiện pattern.`,
    },
  ]

  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  const MAX_ITERATIONS = 25

  await heartbeat({ phase: "starting", iteration: 0, last_action: "Khởi tạo agent goal-driven v2..." })

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      await heartbeat({ phase: "tool_loop", iteration: i + 1, last_action: `Iter ${i + 1}: đang suy nghĩ...`, tokens_used: totalPromptTokens + totalCompletionTokens })

      const res = await client.chat.completions.create({
        model: activeModel,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: 4000,
        temperature: 0.2,
      })

      const msg = res.choices[0].message
      messages.push(msg)
      totalPromptTokens += res.usage?.prompt_tokens ?? 0
      totalCompletionTokens += res.usage?.completion_tokens ?? 0

      if (!msg.tool_calls?.length) {
        await heartbeat({ last_action: `Iter ${i + 1}: agent kết thúc`, tokens_used: totalPromptTokens + totalCompletionTokens })
        break
      }

      const toolNames = msg.tool_calls.map(tc => {
        try {
          const a = JSON.parse(tc.function.arguments)
          if (tc.function.name === "query_ads_db") return `query(${a.sql?.slice(0, 60)}...)`
          if (tc.function.name === "recommend_action") return `recommend(${a.campaign_id?.slice(-6)} → ${a.action})`
          if (tc.function.name === "save_insight") return `insight(${a.category})`
          return tc.function.name
        } catch { return tc.function.name }
      }).join(" | ")
      await heartbeat({ last_action: `Iter ${i + 1}: ${msg.tool_calls.length} tools — ${toolNames.slice(0, 200)}` })

      for (const tc of msg.tool_calls) {
        let args: any = {}
        try { args = JSON.parse(tc.function.arguments) } catch { /* ignore */ }
        const result = await handleTool(tc.function.name, args)
        const resultStr = typeof result === "string" ? result : JSON.stringify(result)
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultStr.slice(0, 12000),
        } as OpenAI.Chat.ChatCompletionMessageParam)

        if (tc.function.name === "recommend_action" && (result as any)?.ok) {
          const cnt = await sql.sql(`SELECT COUNT(*)::int as n FROM agent_camp_recommendation WHERE run_id = $1`, [runId]).catch(() => [{ n: 0 }])
          await heartbeat({ recs_so_far: cnt[0]?.n ?? 0 })
        }
      }
    }
  } catch (loopErr: any) {
    await heartbeat({ phase: "error", error: loopErr.message?.slice(0, 500) })
    throw loopErr
  }

  // Evaluator (giữ nguyên Gemini 3.5 cross-provider)
  const recsForEval = await sql.sql(
    `SELECT id, campaign_id, campaign_name, action, reason, confidence FROM agent_camp_recommendation WHERE run_id = $1`,
    [runId]
  ).catch(() => [])

  if (recsForEval.length > 0) {
    await heartbeat({ phase: "evaluator", last_action: `Evaluator ${EVALUATOR_MODEL} đang đánh giá ${recsForEval.length} recs...` })
    try {
      const evalClient = new OpenAI(
        DEEPSEEK_DIRECT_MODELS.has(EVALUATOR_MODEL)
          ? { baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY ?? "", defaultHeaders: { "X-Title": "PhanViet Camp Evaluator" } }
          : { baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY ?? "", defaultHeaders: { "X-Title": "PhanViet Camp Evaluator" } }
      )

      const evalRes = await evalClient.chat.completions.create({
        model: EVALUATOR_MODEL,
        messages: [
          { role: "system", content: EVALUATOR_SYSTEM_PROMPT },
          { role: "user", content: `Đánh giá ${recsForEval.length} recommendations:\n${JSON.stringify(recsForEval, null, 2)}` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 3000,
        temperature: 0,
      })

      const evalContent = evalRes.choices[0].message.content ?? "{}"
      logger?.info?.(`[CampAI Evaluator] Raw (${evalContent.length} chars): ${evalContent.slice(0, 500)}`)

      let parsed: any = {}
      try { parsed = JSON.parse(evalContent) } catch (parseErr: any) {
        await sql.sql(
          `UPDATE agent_camp_recommendation SET reflection_notes = $1, evaluator_model = $2 WHERE run_id = $3`,
          [`[PARSE_FAIL] ${evalContent.slice(0, 500)}`, EVALUATOR_MODEL, runId]
        ).catch(() => {})
        throw parseErr
      }

      const evaluations: any[] = parsed.evaluations ?? parsed.results ?? parsed.recommendations ?? (Array.isArray(parsed) ? parsed : [])
      if (evaluations.length > 0) {
        let updateCount = 0
        for (const ev of evaluations) {
          const recId = ev.rec_id ?? ev.id ?? ev.recommendation_id
          if (!recId) continue
          await sql.sql(
            `UPDATE agent_camp_recommendation SET reflection_passed = $1, reflection_notes = $2, evaluator_model = $3 WHERE id = $4 AND run_id = $5`,
            [ev.pass ?? ev.passed ?? null, ev.notes ?? ev.note ?? null, EVALUATOR_MODEL, recId, runId]
          ).catch(() => {})
          updateCount++
        }
        await heartbeat({ last_action: `Evaluator: ${updateCount}/${evaluations.length} recs evaluated` })
      } else {
        await heartbeat({ last_action: `Evaluator empty result, schema: ${Object.keys(parsed).join(",")}` })
      }
    } catch (evalErr: any) {
      logger?.warn?.(`[CampAI] Evaluator failed: ${evalErr.message}`)
      await heartbeat({ last_action: `Evaluator error: ${evalErr.message?.slice(0, 200)}` })
    }
  }

  const recs = await sql.sql(`SELECT action, status FROM agent_camp_recommendation WHERE run_id = $1`, [runId]).catch(() => [])
  const insights = await sql.sql(`SELECT COUNT(*)::int as n FROM agent_insight WHERE agent_model = $1 AND created_at > now() - interval '5 minutes'`, [activeModel]).catch(() => [{ n: 0 }])

  const outcomes = {
    total: recs.length,
    pause: recs.filter((r: any) => r.action === "pause").length,
    set_budget: recs.filter((r: any) => r.action === "set_budget").length,
    resume: recs.filter((r: any) => r.action === "resume").length,
    no_action: recs.filter((r: any) => r.action === "no_action").length,
    auto_executed: recs.filter((r: any) => r.status === "auto_executed").length,
    insights_saved: insights[0]?.n ?? 0,
  }

  await sql.sql(
    `INSERT INTO agent_art_rollout (run_id, messages, tool_calls, outcomes, model)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)`,
    [runId, JSON.stringify(messages), JSON.stringify(toolCallLog), JSON.stringify(outcomes), activeModel]
  ).catch(() => {})

  await heartbeat({ phase: "done", last_action: `Hoàn thành: ${outcomes.total} recs (${outcomes.pause}p/${outcomes.set_budget}b/${outcomes.resume}r/${outcomes.no_action}n) + ${outcomes.insights_saved} insights`, recs_so_far: outcomes.total, tokens_used: totalPromptTokens + totalCompletionTokens })

  logger?.info?.(`[CampAI v2] Run ${runId} done — ${outcomes.total} recs, ${outcomes.insights_saved} insights, tokens=${totalPromptTokens}+${totalCompletionTokens}`)
  return { run_id: runId, outcomes }
}

export const config = {
  name: "camp-ai-care",
  schedule: "0 */4 * * *", // Mỗi 4 giờ (giảm từ 2h)
}
