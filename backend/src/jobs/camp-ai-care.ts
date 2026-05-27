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
  "v_camp_dashboard", "v_camp_daily_trend", "v_camp_intraday",
  "v_mkt_daily", "v_mkt_summary", "v_shop_weekly",
  "v_camp_today", "v_camp_history", "v_camp_orders",
  "v_shop_care_daily", "v_camp_care_window",
  "camp_hourly_snapshot", "agent_prediction",
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

const SYSTEM_PROMPT = `Bạn là AI agent tối ưu Facebook Ads cho shop Phan Viet (đồ gia dụng VN).
Tư duy như marketer lead có kinh nghiệm — KHÔNG follow rule cứng, mà dùng skills học được + data hiện tại.

## 🎯 MỤC TIÊU KÉP (cố định)
1. care_pct toàn shop < 30%
2. cod_today toàn shop >= 50.000.000đ/ngày

Hai mục tiêu TENSION nhau. Điều chỉnh aggressiveness theo cod hôm nay.

## 📚 KIẾN THỨC (knowledge base = agent_insight)
KHÔNG có rule cứng / threshold / benchmark nào trong prompt này.
Toàn bộ rule + threshold + pattern nằm trong agent_insight.skill_type='skill'.
PHẢI đọc skills TRƯỚC khi quyết định gì.

## 🛠️ TOOLS
- **query_ads_db(sql)**: SELECT trên các views/tables (xem ALLOWED_TABLES)
- **recommend_action(campaign_id, action, reason, confidence, suggested_daily_budget?)**
- **save_prediction(scope, scope_id, predicted_eod_spend, predicted_eod_cod, predicted_eod_care, basis, skills_used)**
- **save_insight(insight, category, skill_type, condition_when?, action_then?, confidence_pct?, scope?, evidence?)**
- **invalidate_skill(skill_id, reason)**

## 📊 Views chính
- v_shop_care_daily, v_shop_weekly — shop level
- v_mkt_summary, v_mkt_daily — team/MKT level
- v_camp_dashboard — camp hôm nay full context (CPM, CTR, care_today, care_3d/7d, days_running)
- v_camp_intraday — snapshot mới nhất hôm nay (spend_so_far, projected_eod_spend, current_hour)
- v_camp_daily_trend — 14d drill-down per camp
- agent_insight (skills + insights), agent_memory (rejections), agent_prediction (lần trước), agent_camp_recommendation, camp_action_log

## 🧠 WORKFLOW (framework — không phải rule)

**Bước 1: Context tổng quan**
  SELECT * FROM v_shop_care_daily ORDER BY date DESC LIMIT 1  -- cod_today + care
  SELECT * FROM v_shop_weekly LIMIT 3                          -- trend tuần
  → Biết cod_today (bao nhiêu/50tr target), care hiện tại. Đây là context xuyên suốt.

**Bước 2: Đọc skills + phản biện validity**
  SELECT id, insight, condition_when, action_then, confidence_pct,
         times_correct, times_wrong, scope
  FROM agent_insight
  WHERE skill_type='skill' AND active=true
  ORDER BY confidence_pct DESC LIMIT 25
  → Với mỗi skill: data hiện tại có phủ nhận skill không?
    Nếu có evidence mâu thuẫn rõ → invalidate_skill(id, reason)

**Bước 3: Check predictions lần trước (nếu có)**
  SELECT * FROM agent_prediction
  WHERE date = CURRENT_DATE AND prediction_hour < EXTRACT(HOUR FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))
    AND evaluated_at IS NULL
  → So với actual hiện tại: prediction lần trước đang đúng/sai → ghi nhận.

**Bước 4: Scan team + camp**
  SELECT * FROM v_mkt_summary ORDER BY care_rank_7d
  → MKT nào care cao → drill xuống camp:
  SELECT * FROM v_camp_dashboard WHERE mkt_name='X' ORDER BY spend_today DESC
  + JOIN v_camp_intraday để biết spend_so_far, projected_eod_spend hôm nay

**Bước 5: Diagnose root cause (DÙNG SKILLS, không đoán bừa)**
  Với camp nghi vấn:
  - Match condition_when của skills → áp dụng action_then đề xuất
  - Nếu nhiều skills cùng match → ưu tiên skill confidence cao
  - Nếu không skill nào match → kết luận "unknown — chưa đủ pattern", thường no_action

**Bước 6: DỰ ĐOÁN cuối ngày (BẮT BUỘC trước action)**
  - Linear projection từ v_camp_intraday.projected_eod_spend
  - Điều chỉnh theo skills DOW/age/product (vd CN care cao hơn → adjust up)
  - save_prediction(scope, scope_id, predicted_eod_spend, predicted_eod_cod, predicted_eod_care, basis, [skill_ids])
  - Predict cho shop, các MKT, và camp quan trọng

**Bước 7: Phản biện rồi action**
  Trước recommend_action, tự hỏi:
  - "Root cause là gì? Action giải quyết root cause hay symptom?"
  - "Prediction nếu KHÔNG action vs NẾU action chênh bao nhiêu?"
  - "Skill nào đang phản bác action này không?"
  → recommend_action với reason format BẮT BUỘC:
    "shop cod=Xtr/50tr | [root_cause] | predicted EOD care=Y% | skill: <id1>, <id2> | action vì <lý do>"

**Bước 8: Cơ hội + skill mới**
  - SELECT * FROM v_camp_dashboard WHERE effective_status='PAUSED' AND care_7d<25 AND cod_7d>0
  - Nếu thấy pattern mới lặp ≥ 2 lần → save_insight(skill_type='skill', condition_when, action_then, confidence_pct=55)

## ⚠️ INVARIANTS (chỉ những điều TUYỆT ĐỐI)
- Không action camp days_running < 3
- set_budget chỉ được giảm (không tăng)
- resume bắt buộc suggested_daily_budget
- Reason phải chứa: cod_today + skill_ids đã áp dụng (nếu có)
- TRƯỚC recommend_action: query agent_camp_recommendation WHERE created_at > now()-interval '24 hours' AND status IN ('pending','approved','auto_executed') → SKIP nếu đã có

## 💡 Triết lý
Skills là kinh nghiệm tích lũy — chúng có thể sai. Khi data mâu thuẫn skill, ĐỪNG mù quáng follow.
Bạn được phép phản biện chính skill đã lưu (invalidate_skill).
Cuối cùng outcome quyết định: skill nào dự đoán đúng → confidence tăng; sai → giảm; sai liên tục → auto-invalidate.`

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "query_ads_db",
      description: "Chạy SELECT SQL. Workflow: (1) v_mkt_summary → xem hiệu suất team, ai đang kéo care lên; (2) v_shop_weekly → trend tuần; (3) v_camp_dashboard → camp của MKT có vấn đề; (4) v_camp_daily_trend → drill-down 14d per camp; (5) v_mkt_daily → trend ngày per MKT. Cũng có: v_shop_care_daily, agent_insight, agent_memory, agent_camp_recommendation.",
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
      description: "Lưu insight/skill học được. skill_type='skill' (có condition+action, tái sử dụng) hoặc 'insight' (observation thuần).",
      parameters: {
        type: "object",
        properties: {
          insight: { type: "string", description: "Mô tả ngắn pattern, < 500 chars" },
          category: { type: "string", enum: ["diagnosis", "opportunity", "pattern", "warning"] },
          skill_type: { type: "string", enum: ["insight", "skill"], description: "skill = rule có thể tái sử dụng (cần condition_when+action_then); insight = observation" },
          condition_when: { type: "string", description: "Khi nào áp dụng (chỉ khi skill_type=skill). Vd 'mkt_name=X AND cpm > 500000'" },
          action_then: { type: "string", description: "Nên làm gì (chỉ khi skill_type=skill)" },
          confidence_pct: { type: "number", description: "% tin cậy ban đầu 0-100, default 55" },
          scope: { type: "object", description: "{ mkt?, product?, time_range? }" },
          evidence: { type: "object", description: "{ sample_size, data_points }" },
        },
        required: ["insight", "category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_prediction",
      description: "Lưu dự đoán cuối ngày. BẮT BUỘC gọi sau khi diagnose, TRƯỚC khi recommend_action. Dùng để evaluate cuối ngày + update skill confidence.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["shop", "mkt", "camp"], description: "shop = toàn shop, mkt = 1 MKT, camp = 1 campaign" },
          scope_id: { type: "string", description: "mkt_name hoặc campaign_id (bỏ trống nếu scope=shop)" },
          predicted_eod_spend: { type: "number", description: "VND, spend cuối ngày dự đoán" },
          predicted_eod_cod: { type: "number", description: "VND, COD cuối ngày dự đoán" },
          predicted_eod_care: { type: "number", description: "% care cuối ngày dự đoán" },
          basis: { type: "string", description: "Cơ sở dự đoán (vd 'linear pace 8h×3, adjust +10% theo DOW=CN')" },
          skills_used: { type: "array", items: { type: "string" }, description: "Array of skill IDs đã dùng trong prediction" },
        },
        required: ["scope", "predicted_eod_spend", "predicted_eod_cod", "predicted_eod_care", "basis"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "invalidate_skill",
      description: "Đánh dấu skill cũ không còn valid khi data hiện tại phủ nhận. Dùng khi evidence rõ ràng mâu thuẫn với condition_when/action_then của skill.",
      parameters: {
        type: "object",
        properties: {
          skill_id: { type: "string", description: "UUID skill trong agent_insight" },
          reason: { type: "string", description: "Lý do invalidate, có evidence cụ thể" },
        },
        required: ["skill_id", "reason"],
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

  // Kiểm tra feature flag từ DB — admin có thể tắt qua /app/ai-settings
  const agentCfg = await sql.sql(
    `SELECT enabled, model FROM ai_feature_config WHERE key = 'camp_ai_agent' LIMIT 1`
  ).catch(() => [])
  if (agentCfg.length > 0 && agentCfg[0].enabled === false) {
    logger?.info?.("[CampAI] Tắt bởi ai_feature_config.camp_ai_agent — skipping")
    return
  }
  // Model override từ DB nếu không truyền tay
  const dbModel = agentCfg[0]?.model
  const runId = randomUUID()
  const activeModel = opts?.model ?? dbModel ?? MODEL

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

      const recIns = await sql.sql(
        `INSERT INTO agent_camp_recommendation
           (run_id, campaign_id, campaign_name, mkt_name, action, reason, old_value, suggested_value, confidence, status, executed_at, fb_response, agent_model)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13)
         RETURNING id`,
        [runId, args.campaign_id, camp.campaign_name, camp.mkt_name,
         args.action, args.reason, JSON.stringify(oldValue),
         JSON.stringify(suggestedValue), args.confidence ?? "medium",
         status, executedAt, JSON.stringify(fbResp), activeModel]
      ).catch((e: any) => { logger?.error?.("[CampAI] insert rec fail:", e.message); return [] })

      // Snapshot BEFORE — chụp metrics tại thời điểm decide
      const recId = recIns?.[0]?.id
      if (recId) {
        await sql.sql(
          `INSERT INTO agent_decision_snapshot
             (rec_id, run_id, campaign_id, snapshot_type,
              spend, impressions, clicks, cod_orders, cod_amount,
              care_pct, cpm, ctr_pct, effective_status, daily_budget,
              shop_care_pct, shop_cod)
           SELECT $1, $2, $3, 'before',
             c.spend_today, c.impressions, c.clicks, c.cod_orders_today, c.cod_today,
             c.care_today, c.cpm, c.ctr_pct, c.effective_status, c.daily_budget,
             s.care_pct, s.total_cod
           FROM v_camp_dashboard c
           CROSS JOIN (SELECT care_pct, total_cod FROM v_shop_care_daily ORDER BY date DESC LIMIT 1) s
           WHERE c.campaign_id = $3
           ON CONFLICT (rec_id, snapshot_type) DO NOTHING`,
          [recId, runId, args.campaign_id]
        ).catch(() => {})
      }

      return { ok: true, status, campaign_name: camp.campaign_name }
    }

    if (name === "save_insight") {
      if (!args.insight || args.insight.length < 30) {
        return { error: "Insight quá ngắn (<30 chars)." }
      }
      const skillType = args.skill_type === "skill" ? "skill" : "insight"
      if (skillType === "skill" && (!args.condition_when || !args.action_then)) {
        return { error: "skill_type='skill' bắt buộc có condition_when + action_then" }
      }
      const ins = await sql.sql(
        `INSERT INTO agent_insight
           (insight, category, scope, evidence, agent_model,
            skill_type, condition_when, action_then, confidence_pct, source)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, 'agent')
         RETURNING id`,
        [args.insight, args.category ?? "pattern",
         JSON.stringify(args.scope ?? {}),
         JSON.stringify(args.evidence ?? {}),
         activeModel,
         skillType, args.condition_when ?? null, args.action_then ?? null,
         Math.max(10, Math.min(95, Number(args.confidence_pct ?? 55)))]
      ).catch((e: any) => { logger?.error?.("[CampAI] save insight fail:", e.message); return [] })
      return { ok: true, id: ins[0]?.id }
    }

    if (name === "save_prediction") {
      const vnNow = new Date(Date.now() + 7 * 3600 * 1000)
      const vnHour = vnNow.getUTCHours()
      const skillIds = Array.isArray(args.skills_used) ? args.skills_used : []
      await sql.sql(
        `INSERT INTO agent_prediction
           (run_id, date, prediction_hour, scope, scope_id,
            predicted_eod_spend, predicted_eod_cod, predicted_eod_care,
            prediction_basis, skills_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
        [runId, today, vnHour,
         args.scope, args.scope_id ?? null,
         Math.round(Number(args.predicted_eod_spend ?? 0)),
         Math.round(Number(args.predicted_eod_cod ?? 0)),
         Number(args.predicted_eod_care ?? 0),
         args.basis ?? "",
         JSON.stringify(skillIds)]
      ).catch((e: any) => logger?.error?.("[CampAI] save_prediction fail:", e.message))
      return { ok: true }
    }

    if (name === "invalidate_skill") {
      if (!args.skill_id || !args.reason) {
        return { error: "Cần skill_id + reason" }
      }
      const r = await sql.sql(
        `UPDATE agent_insight
         SET active = false, invalidated_at = now(), invalidation_reason = $2
         WHERE id = $1 AND active = true
         RETURNING id`,
        [args.skill_id, args.reason]
      ).catch(() => [])
      if (!r.length) return { error: "Skill không tồn tại hoặc đã invalidated" }
      return { ok: true, message: `Skill ${args.skill_id} invalidated` }
    }

    return { error: `Unknown tool: ${name}` }
  }

  const mktCtx = opts?.mkt ? `MKT ${opts.mkt}` : "toàn shop"
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Hôm nay ${today}. Tối ưu ${mktCtx} cho dual goal: care < 30% VÀ cod >= 50tr.

Theo workflow 8 bước trong system prompt:
1. Lấy cod_today + care hôm nay (v_shop_care_daily) + trend tuần (v_shop_weekly)
2. Đọc skills (agent_insight WHERE skill_type='skill' AND active=true) — phản biện skill nào không còn đúng
3. Check predictions lần trước (agent_prediction hôm nay) — đúng/sai?
4. Scan team (v_mkt_summary) + drill camp MKT có vấn đề (v_camp_dashboard + v_camp_intraday)
5. Diagnose root cause dùng SKILLS (không đoán bừa)
6. DỰ ĐOÁN cuối ngày bằng save_prediction (BẮT BUỘC trước khi action)
7. Phản biện rồi recommend_action — reason phải có cod_today + skill_ids
8. Cơ hội resume + tạo skill mới nếu thấy pattern

Bắt đầu ngay.`,
    },
  ]

  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  const MAX_ITERATIONS = 35  // 8-step workflow + predictions + diagnose nhiều camps cần budget cao hơn

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
          if (tc.function.name === "save_insight") return `insight(${a.skill_type ?? "insight"}/${a.category})`
          if (tc.function.name === "save_prediction") return `predict(${a.scope}${a.scope_id ? ":" + a.scope_id.slice(-6) : ""} → care=${a.predicted_eod_care}%)`
          if (tc.function.name === "invalidate_skill") return `invalidate(${a.skill_id?.slice(-6)})`
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

  const evalCfg = await sql.sql(
    `SELECT enabled, model FROM ai_feature_config WHERE key = 'camp_ai_evaluator' LIMIT 1`
  ).catch(() => [])
  const evaluatorEnabled = evalCfg.length === 0 || evalCfg[0].enabled !== false
  const activeEvaluatorModel = evalCfg[0]?.model ?? EVALUATOR_MODEL

  if (recsForEval.length > 0 && evaluatorEnabled) {
    await heartbeat({ phase: "evaluator", last_action: `Evaluator ${activeEvaluatorModel} đang đánh giá ${recsForEval.length} recs...` })
    try {
      const evalClient = new OpenAI(
        DEEPSEEK_DIRECT_MODELS.has(activeEvaluatorModel)
          ? { baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY ?? "", defaultHeaders: { "X-Title": "PhanViet Camp Evaluator" } }
          : { baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY ?? "", defaultHeaders: { "X-Title": "PhanViet Camp Evaluator" } }
      )

      const evalRes = await evalClient.chat.completions.create({
        model: activeEvaluatorModel,
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
      try {
        // Try direct parse first, then extract from markdown code block
        let jsonStr = evalContent.trim()
        if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) {
          const m = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
          if (m) jsonStr = m[1].trim()
          else {
            const start = jsonStr.indexOf("{")
            if (start !== -1) jsonStr = jsonStr.slice(start)
          }
        }
        parsed = JSON.parse(jsonStr)
      } catch (parseErr: any) {
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

  // ── LEARNING LOOP ──────────────────────────────────────────────────────────
  // 1. Evaluate predictions từ run này vs actual hiện tại
  try {
    const preds = await sql.sql(
      `SELECT id, scope, scope_id, predicted_eod_care, predicted_eod_cod, skills_used
       FROM agent_prediction WHERE run_id = $1`,
      [runId]
    ).catch(() => [])

    if (preds.length > 0) {
      const shopActual = await sql.sql(
        `SELECT care_pct, total_cod FROM v_shop_care_daily ORDER BY date DESC LIMIT 1`
      ).catch(() => [])
      const actualCare = Number(shopActual[0]?.care_pct ?? 0)
      const actualCod  = Number(shopActual[0]?.total_cod ?? 0)

      for (const pred of preds) {
        const pCare = Number(pred.predicted_eod_care ?? 0)
        const pCod  = Number(pred.predicted_eod_cod ?? 0)
        // Prediction "đúng" nếu sai lệch care < 8pp VÀ cod < 30%
        const careOk = Math.abs(pCare - actualCare) < 8
        const codOk  = pCod > 0 ? Math.abs(pCod - actualCod) / Math.max(pCod, actualCod) < 0.3 : true
        const correct = careOk && codOk

        // Ghi actual vào prediction
        await sql.sql(
          `UPDATE agent_prediction SET actual_eod_care=$1, actual_eod_cod=$2, evaluated_at=now() WHERE id=$3`,
          [actualCare, actualCod, pred.id]
        ).catch(() => {})

        // Update times_correct / times_wrong + outcome_score cho từng skill đã dùng
        const skillIds: string[] = Array.isArray(pred.skills_used) ? pred.skills_used : []
        for (const sid of skillIds) {
          if (!sid) continue
          if (correct) {
            await sql.sql(
              `UPDATE agent_insight
               SET times_correct = COALESCE(times_correct,0) + 1,
                   applied_count  = COALESCE(applied_count,0) + 1,
                   last_used_at   = now(),
                   outcome_score  = ROUND(
                     (COALESCE(times_correct,0) + 1)::numeric /
                     NULLIF(COALESCE(times_correct,0) + COALESCE(times_wrong,0) + 1, 0) * 100
                   , 1),
                   confidence_pct = LEAST(90, GREATEST(30,
                     COALESCE(confidence_pct,55) + CASE WHEN COALESCE(times_correct,0) < 5 THEN 3 ELSE 1 END
                   ))
               WHERE id = $1`,
              [sid]
            ).catch(() => {})
          } else {
            await sql.sql(
              `UPDATE agent_insight
               SET times_wrong   = COALESCE(times_wrong,0) + 1,
                   applied_count  = COALESCE(applied_count,0) + 1,
                   last_used_at   = now(),
                   outcome_score  = ROUND(
                     COALESCE(times_correct,0)::numeric /
                     NULLIF(COALESCE(times_correct,0) + COALESCE(times_wrong,0) + 1, 0) * 100
                   , 1),
                   confidence_pct = GREATEST(20,
                     COALESCE(confidence_pct,55) - CASE WHEN COALESCE(times_wrong,0) < 3 THEN 4 ELSE 2 END
                   ),
                   -- Auto-invalidate nếu wrong >= 5 liên tiếp và outcome_score < 30
                   active = CASE
                     WHEN COALESCE(times_wrong,0) + 1 >= 5
                       AND COALESCE(times_correct,0) = 0
                     THEN false ELSE active
                   END,
                   invalidated_at = CASE
                     WHEN COALESCE(times_wrong,0) + 1 >= 5
                       AND COALESCE(times_correct,0) = 0
                     THEN now() ELSE invalidated_at
                   END,
                   invalidation_reason = CASE
                     WHEN COALESCE(times_wrong,0) + 1 >= 5
                       AND COALESCE(times_correct,0) = 0
                     THEN 'Auto-invalidated: 5+ wrong, 0 correct' ELSE invalidation_reason
                   END
               WHERE id = $1`,
              [sid]
            ).catch(() => {})
          }
        }
      }
      await heartbeat({ last_action: `Learning loop: ${preds.length} predictions evaluated, skills updated` })
    }
  } catch (learnErr: any) {
    logger?.warn?.("[CampAI] Learning loop error:", learnErr.message)
  }

  // 2. Populate rejection feedback vào agent_memory khi rec bị reject
  try {
    const rejected = await sql.sql(
      `SELECT id, campaign_id, campaign_name, mkt_name, action, reason, rejection_reason
       FROM agent_camp_recommendation
       WHERE run_id = $1 AND status = 'rejected' AND rejection_reason IS NOT NULL`,
      [runId]
    ).catch(() => [])

    for (const r of rejected) {
      await sql.sql(
        `INSERT INTO agent_memory (campaign_id, mkt_name, memory_type, content, source, created_at)
         VALUES ($1, $2, 'rejection', $3::jsonb, 'manager', now())
         ON CONFLICT DO NOTHING`,
        [r.campaign_id, r.mkt_name,
         JSON.stringify({ rec_id: r.id, action: r.action, agent_reason: r.reason, rejection_reason: r.rejection_reason })]
      ).catch(() => {})
    }
  } catch { /* non-critical */ }
  // ── END LEARNING LOOP ──────────────────────────────────────────────────────

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

  // Auto-parse reasoning steps (inline, không block flow chính)
  try {
    let stepIdx = 0
    for (const m of messages as any[]) {
      if (m.role === "system") continue
      if (m.role === "assistant") {
        if (typeof m.content === "string" && m.content.trim().length > 0) {
          await sql.sql(
            `INSERT INTO agent_reasoning_step (run_id, step_idx, step_type, message_text, token_estimate)
             VALUES ($1, $2, 'thinking', $3, $4) ON CONFLICT (run_id, step_idx) DO NOTHING`,
            [runId, stepIdx++, m.content, Math.ceil(m.content.length / 4)]
          ).catch(() => {})
        }
        if (Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            const fn = tc.function ?? {}
            let parsedArgs: any = {}
            try { parsedArgs = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : (fn.arguments ?? {}) } catch {}
            const argStr = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(parsedArgs)
            await sql.sql(
              `INSERT INTO agent_reasoning_step (run_id, step_idx, step_type, tool_name, tool_args, token_estimate)
               VALUES ($1, $2, 'tool_call', $3, $4::jsonb, $5) ON CONFLICT (run_id, step_idx) DO NOTHING`,
              [runId, stepIdx++, fn.name ?? "unknown", JSON.stringify(parsedArgs), Math.ceil(argStr.length / 4)]
            ).catch(() => {})
          }
        }
      }
      if (m.role === "tool") {
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
        const summary = text.length > 300 ? text.slice(0, 300) + "..." : text
        await sql.sql(
          `INSERT INTO agent_reasoning_step (run_id, step_idx, step_type, tool_name, tool_result_summary, tool_result_size, token_estimate)
           VALUES ($1, $2, 'tool_result', $3, $4, $5, $6) ON CONFLICT (run_id, step_idx) DO NOTHING`,
          [runId, stepIdx++, m.name ?? null, summary, text.length, Math.ceil(text.length / 4)]
        ).catch(() => {})
      }
    }
  } catch (e: any) {
    logger?.warn?.("[CampAI] reasoning parse failed:", e.message)
  }

  await heartbeat({ phase: "done", last_action: `Hoàn thành: ${outcomes.total} recs (${outcomes.pause}p/${outcomes.set_budget}b/${outcomes.resume}r/${outcomes.no_action}n) + ${outcomes.insights_saved} insights`, recs_so_far: outcomes.total, tokens_used: totalPromptTokens + totalCompletionTokens })

  logger?.info?.(`[CampAI v2] Run ${runId} done — ${outcomes.total} recs, ${outcomes.insights_saved} insights, tokens=${totalPromptTokens}+${totalCompletionTokens}`)
  return { run_id: runId, outcomes }
}

export const config = {
  name: "camp-ai-care",
  schedule: "0 */4 * * *", // Mỗi 4 giờ (giảm từ 2h)
}
