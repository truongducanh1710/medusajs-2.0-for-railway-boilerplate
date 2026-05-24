import { MedusaContainer } from "@medusajs/framework"
import OpenAI from "openai"
import { randomUUID } from "crypto"
import { callFbApi } from "../api/admin/pancake-sync/report/camp-control/_lib"

const MODEL = process.env.CAMP_AI_MODEL ?? "deepseek-v4-flash"
const EVALUATOR_MODEL = process.env.CAMP_AI_EVALUATOR_MODEL ?? "deepseek-v4-pro"
const DEEPSEEK_DIRECT_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"])

const SYSTEM_PROMPT = `Bạn là AI chuyên phân tích quảng cáo Facebook cho shop Phan Viet (đồ gia dụng: chổi, nồi, chảo, hộp nhựa...) tại Việt Nam.

## Cách đánh giá camp

### 1. % Care (chi phí / COD) — tiêu chí quan trọng nhất
- < 25%: Xuất sắc — duy trì, có thể tăng budget
- 25-30%: Tốt — giữ nguyên
- 30-35%: Cảnh báo — theo dõi thêm 1-2 ngày
- 35-40%: Kém — cân nhắc giảm budget 20-30%
- > 40%: Tệ — pause hoặc giảm budget mạnh

### 2. Tỉ lệ COD/Clicks (conversion rate)
- Tính: cod_orders / clicks × 100
- > 3%: Tốt — offer và landing page hiệu quả
- 1-3%: Trung bình
- < 1%: Kém — KHÔNG tăng budget dù CPM thấp

### 3. CPM (VND/1000 lượt hiển thị)
- < 200k: Rất tốt
- 200-350k: Bình thường cho ngành gia dụng VN
- 350-500k: Cao — audience có thể bão hòa
- > 500k: Rất cao — nên refresh audience

### 4. Trend 3-5 ngày (ƯU TIÊN hơn ngưỡng tuyệt đối)
- Camp mới (< 3 ngày): KHÔNG pause dù KPI xấu
- Trend xuống 3 ngày liên tiếp: dấu hiệu bão hòa
- CPM tăng > 2x so 3 ngày trước: audience bão hòa
- 1 ngày xấu trong chuỗi tốt: KHÔNG panic — theo dõi

## Điều kiện pause (thỏa MÃN ÍT NHẤT 1)
1. care_pct > 35% VÀ spend hôm nay > 300.000đ VÀ camp đã chạy > 3 ngày
2. Camp chạy > 3 ngày có spend nhưng total COD = 0
3. CPM hôm nay > 2× CPM trung bình 3 ngày trước VÀ care_pct > 35%
4. care_pct > 40% bất kể spend (ngưỡng cứng)

## Điều kiện KHÔNG pause
- Camp < 3 ngày tuổi
- MKT mới (LINHMT, DUPD) spend < 200k/ngày
- Đang có pending schedule manual từ marketer

## Format recommend — PHẢI actionable
Reason phải có: KPI cụ thể + trend + so sánh với MKT + action rõ ràng.
VD tốt: "care_pct 42% tăng 3 ngày (38→40→42%), CPM 580k vượt ngưỡng 500k, COD/Click 0.7%. Pause ngay."
VD xấu: "Hiệu suất chưa tốt, cần theo dõi thêm." ← KHÔNG chấp nhận`

const EVALUATOR_SYSTEM_PROMPT = `Bạn là evaluator độc lập kiểm tra chất lượng recommendation của AI agent phân tích quảng cáo.

Với mỗi recommendation, đánh giá theo tiêu chí:
1. Reason có chứa KPI số liệu cụ thể không (ít nhất 1 con số)?
2. Action có logic với KPI không (vd pause camp < 3 ngày = sai)?
3. Confidence có phù hợp với mức độ chắc chắn của reason không?
4. Reason có ≥ 40 ký tự không?

Trả về JSON với format: { "evaluations": [{ "rec_id": "uuid", "pass": true/false, "notes": "ghi chú ngắn nếu fail" }] }`

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_camp_metrics",
      description: "Lấy metrics 14 ngày của camp(s): spend, CPM, CPC, CTR, COD orders, care_pct, status, budget theo từng ngày",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "Để trống = lấy tất cả camp active trong 14 ngày" },
          mkt: { type: "string", description: "Filter theo MKT code" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_mkt_benchmarks",
      description: "Lấy trung bình CPM/CPC/care_pct/CTR của toàn MKT trong 14 ngày để so sánh",
      parameters: {
        type: "object",
        properties: {
          mkt: { type: "string" },
        },
        required: ["mkt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_rejections",
      description: "Lấy các action đã bị marketer reject trong 14 ngày cho MKT này. PHẢI gọi trước khi recommend để tránh suggest lại pattern đã bị từ chối.",
      parameters: {
        type: "object",
        properties: {
          mkt: { type: "string", description: "MKT code để filter rejection history" },
        },
        required: ["mkt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_action",
      description: "Ghi recommendation vào DB. Gọi cho MỖI camp đã phân tích (kể cả no_action)",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
          action: { type: "string", enum: ["pause", "set_budget", "no_action"] },
          reason: { type: "string", description: "KPI cụ thể + trend + action rõ ràng, < 300 chars" },
          suggested_daily_budget: { type: "number", description: "VND, chỉ khi action=set_budget, phải THẤP HƠN budget hiện tại" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["campaign_id", "action", "reason", "confidence"],
      },
    },
  },
]

const UPDATE_REC_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "update_recommendation",
    description: "Cập nhật reason/confidence của 1 recommendation đã tạo (dùng trong phase self-reflection)",
    parameters: {
      type: "object",
      properties: {
        rec_id: { type: "string", description: "UUID của recommendation cần sửa" },
        new_reason: { type: "string", description: "Reason mới với KPI cụ thể hơn" },
        new_confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["rec_id", "new_reason"],
    },
  },
}

function validateRecommendation(args: any, camp: any): { ok: boolean; error?: string } {
  if (!args.reason || args.reason.length < 40)
    return { ok: false, error: "Reason quá ngắn (<40 chars). Cần KPI số liệu cụ thể + trend + action." }
  if (!/\d/.test(args.reason))
    return { ok: false, error: "Reason phải chứa ít nhất 1 con số (CPM, care_pct, spend...)." }
  if (args.action === "set_budget") {
    if (!args.suggested_daily_budget || args.suggested_daily_budget < 50000)
      return { ok: false, error: "set_budget cần suggested_daily_budget >= 50000 VND." }
    if (args.suggested_daily_budget >= Number(camp.daily_budget))
      return { ok: false, error: "Agent chỉ được GIẢM budget, không tăng." }
  }
  if (args.action === "pause" && Number(camp.days_running ?? 0) < 3)
    return { ok: false, error: `Camp mới ${camp.days_running} ngày, không được pause (rule: > 3 ngày).` }
  return { ok: true }
}

// Rule-based ground truth để bootstrap reward signal
function ruleDecision(camp: any): { action: string; reason: string } {
  const care = Number(camp.care_pct_today ?? 0)
  const spend = Number(camp.spend_today ?? 0)
  const days = Number(camp.days_running ?? 0)
  const cod = Number(camp.cod_today ?? 0)
  const cpmToday = Number(camp.cpm_today ?? 0)
  const cpmAvg3d = Number(camp.cpm_avg_3d ?? 0)

  if (care > 40)
    return { action: "pause", reason: `care_pct ${care}% > ngưỡng cứng 40%` }
  if (days > 3 && spend > 0 && cod === 0)
    return { action: "pause", reason: `Chạy ${days} ngày không có đơn` }
  if (care > 35 && spend > 300000 && days > 3)
    return { action: "pause", reason: `care_pct ${care}%, spend ${Math.round(spend / 1000)}k, ${days} ngày` }
  if (cpmAvg3d > 0 && cpmToday > cpmAvg3d * 2 && care > 35)
    return { action: "set_budget", reason: `CPM ${Math.round(cpmToday / 1000)}k > 2× avg ${Math.round(cpmAvg3d / 1000)}k, care ${care}%` }
  return { action: "no_action", reason: "KPI trong ngưỡng chấp nhận" }
}

async function canAutoExecute(campaignId: string, action: string, suggestedBudget: number | undefined, mktName: string, sql: any): Promise<boolean> {
  if (!["pause", "set_budget"].includes(action)) return false

  // Chỉ giảm budget, không tăng
  if (action === "set_budget" && suggestedBudget != null) {
    const rows = await sql(`SELECT daily_budget FROM mkt_ads_cost WHERE campaign_id = $1 ORDER BY date DESC LIMIT 1`, [campaignId]).catch(() => [])
    if (!rows.length || suggestedBudget >= Number(rows[0].daily_budget)) return false
  }

  // MKT phải được admin bật agent_auto
  const autoUsers = await sql(
    `SELECT metadata->>'mkt_code' as mkt_code FROM "user" WHERE metadata->>'agent_auto' = 'true' AND deleted_at IS NULL`
  ).catch(() => [])
  if (!autoUsers.some((u: any) => u.mkt_code === mktName)) return false

  // Không conflict với pending manual schedule
  const pending = await sql(
    `SELECT id FROM camp_schedule WHERE campaign_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
    [campaignId]
  ).catch(() => [])
  if (pending.length > 0) return false

  // Rate limit: 1 auto action / camp / giờ
  const recent = await sql(
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
    logger?.warn?.("[CampAI] No API key set (OPENROUTER_API_KEY or DEEPSEEK_API_KEY), skipping")
    return
  }

  const runId = randomUUID()
  const activeModel = opts?.model ?? MODEL

  const client = new OpenAI(
    DEEPSEEK_DIRECT_MODELS.has(activeModel)
      ? { baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY ?? "", defaultHeaders: { "X-Title": "PhanViet Camp AI" } }
      : { baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY ?? "", defaultHeaders: { "X-Title": "PhanViet Camp AI" } }
  )
  const today = new Date().toISOString().slice(0, 10)
  logger?.info?.(`[CampAI] Run ${runId} started model=${activeModel}`)

  // Camp map: campaign_id → full data (built during tool calls)
  const campMap = new Map<string, any>()
  const toolCallLog: any[] = []
  const ruleDecisions: Record<string, any> = {}
  // Track validation retries per campaign
  const validationRetries: Record<string, number> = {}

  async function handleTool(name: string, args: any): Promise<any> {
    toolCallLog.push({ name, args, ts: Date.now() })

    if (name === "get_camp_metrics") {
      const mktFilter = args.mkt ?? opts?.mkt ?? ""
      const campFilter = args.campaign_id ?? ""

      // Camp active trong 14 ngày
      const camps = await sql.sql(`
        SELECT
          c.campaign_id,
          c.campaign_name,
          c.mkt_name,
          c.effective_status,
          c.daily_budget,
          c.spend AS spend_today,
          c.impressions AS impr_today,
          c.clicks AS clicks_today,
          CASE WHEN c.impressions > 0 THEN ROUND(c.spend::numeric / c.impressions * 1000) END AS cpm_today,
          CASE WHEN c.clicks > 0 THEN ROUND(c.spend::numeric / c.clicks) END AS cpc_today,
          CASE WHEN c.impressions > 0 THEN ROUND(c.clicks::numeric / c.impressions * 100, 2) END AS ctr_today,
          COALESCE(h.care_pct, 0) AS care_pct_today,
          COALESCE(h.cod_orders, 0) AS cod_today,
          MIN(first_seen.date) AS first_date,
          (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - MIN(first_seen.date) AS days_running,
          (SELECT ROUND(AVG(h3.cpm)) FROM mkt_ads_cost h3
            WHERE h3.campaign_id = c.campaign_id
              AND h3.date BETWEEN (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 4 AND (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 1
              AND h3.impressions > 0) AS cpm_avg_3d
        FROM mkt_ads_cost c
        LEFT JOIN (
          SELECT mac.campaign_id,
            ROUND(SUM(mac.spend)::numeric / NULLIF(SUM(po.cod_amount), 0) * 100, 1) AS care_pct,
            COUNT(po.id) AS cod_orders
          FROM mkt_ads_cost mac
          LEFT JOIN pancake_order po
            ON po.deleted_at IS NULL AND po.source IN ('manual','webcake')
            AND NOT (po.tags @> '[{"name":"Đơn nháp"}]'::jsonb)
            AND NOT (po.tags @> '[{"name":"Đơn trùng"}]'::jsonb)
            AND (po.raw->>'p_utm_source' = mac.campaign_name OR po.raw->>'p_utm_campaign' = mac.campaign_name)
            AND po.pancake_created_at::date = mac.date
          WHERE mac.date = (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL)
          GROUP BY mac.campaign_id
        ) h ON h.campaign_id = c.campaign_id
        LEFT JOIN (
          SELECT campaign_id, MIN(date) AS date FROM mkt_ads_cost
          WHERE deleted_at IS NULL GROUP BY campaign_id
        ) first_seen ON first_seen.campaign_id = c.campaign_id
        WHERE c.date = (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL)
          AND c.deleted_at IS NULL
          AND c.campaign_id IN (
            SELECT DISTINCT campaign_id FROM mkt_ads_cost
            WHERE date >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 14 AND spend > 0 AND deleted_at IS NULL
          )
          ${mktFilter ? `AND c.mkt_name = '${mktFilter.replace(/'/g, "''")}'` : ""}
          ${campFilter ? `AND c.campaign_id = '${campFilter.replace(/'/g, "''")}'` : ""}
        GROUP BY c.campaign_id, c.campaign_name, c.mkt_name, c.effective_status,
                 c.daily_budget, c.spend, c.impressions, c.clicks, h.care_pct, h.cod_orders
        ORDER BY c.spend DESC
        LIMIT 60
      `).catch(() => [])

      // Lấy trend 7 ngày per camp
      const campIds = camps.map((c: any) => c.campaign_id)
      let trends: any[] = []
      if (campIds.length > 0) {
        trends = await sql.sql(`
          SELECT campaign_id, date, spend, impressions, clicks,
            CASE WHEN impressions > 0 THEN ROUND(spend::numeric / impressions * 1000) END AS cpm,
            CASE WHEN clicks > 0 THEN ROUND(spend::numeric / clicks) END AS cpc,
            CASE WHEN impressions > 0 THEN ROUND(clicks::numeric / impressions * 100, 2) END AS ctr
          FROM mkt_ads_cost
          WHERE campaign_id = ANY($1::varchar[])
            AND date >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 7
            AND date <= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL)
            AND deleted_at IS NULL
          ORDER BY campaign_id, date DESC
        `, [campIds]).catch(() => [])
      }

      // Build map và compute rule decisions
      for (const c of camps) {
        const campTrends = trends.filter((t: any) => t.campaign_id === c.campaign_id)
        const enriched = { ...c, trend_7d: campTrends }
        campMap.set(c.campaign_id, enriched)
        ruleDecisions[c.campaign_id] = ruleDecision(enriched)
      }

      return camps.map((c: any) => ({
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        mkt_name: c.mkt_name,
        effective_status: c.effective_status,
        daily_budget: c.daily_budget,
        days_running: c.days_running,
        today: {
          spend: c.spend_today, impressions: c.impr_today, clicks: c.clicks_today,
          cpm: c.cpm_today, cpc: c.cpc_today, ctr: c.ctr_today,
          care_pct: c.care_pct_today, cod_orders: c.cod_today,
        },
        cpm_avg_3d: c.cpm_avg_3d,
        trend_7d: trends.filter((t: any) => t.campaign_id === c.campaign_id)
          .map((t: any) => ({ date: t.date, spend: t.spend, cpm: t.cpm, cpc: t.cpc, ctr: t.ctr })),
      }))
    }

    if (name === "get_mkt_benchmarks") {
      const rows = await sql.sql(`
        SELECT
          ROUND(AVG(CASE WHEN impressions > 0 THEN spend::numeric / impressions * 1000 END)) AS avg_cpm,
          ROUND(AVG(CASE WHEN clicks > 0 THEN spend::numeric / clicks END)) AS avg_cpc,
          ROUND(AVG(CASE WHEN impressions > 0 THEN clicks::numeric / impressions * 100 END), 2) AS avg_ctr,
          COUNT(DISTINCT campaign_id) AS camp_count
        FROM mkt_ads_cost
        WHERE mkt_name = $1 AND date >= (SELECT MAX(date) FROM mkt_ads_cost WHERE deleted_at IS NULL) - 14 AND spend > 0 AND deleted_at IS NULL
      `, [args.mkt]).catch(() => [{}])
      return rows[0]
    }

    if (name === "get_recent_rejections") {
      const rows = await sql.sql(`
        SELECT campaign_id, action, rejection_reason, rejected_count, last_rejected_at
        FROM agent_memory
        WHERE mkt_name = $1 AND last_rejected_at > now() - interval '14 days'
        ORDER BY rejected_count DESC, last_rejected_at DESC
        LIMIT 30
      `, [args.mkt]).catch(() => [])
      return rows.length > 0 ? rows : { message: "Không có rejection nào trong 14 ngày — tự do recommend." }
    }

    if (name === "recommend_action") {
      const camp = campMap.get(args.campaign_id)
      if (!camp) return { error: "campaign_id không tồn tại trong data đã load" }

      // Structured validation with retry
      const retries = validationRetries[args.campaign_id] ?? 0
      if (retries < 3) {
        const validation = validateRecommendation(args, camp)
        if (!validation.ok) {
          validationRetries[args.campaign_id] = retries + 1
          logger?.warn?.(`[CampAI] Validation failed for ${args.campaign_id} (retry ${retries + 1}/3): ${validation.error}`)
          // Update validation_retries in DB if rec already exists
          await sql.sql(
            `UPDATE agent_camp_recommendation SET validation_retries = $1 WHERE run_id = $2 AND campaign_id = $3`,
            [retries + 1, runId, args.campaign_id]
          ).catch(() => {})
          return { error: validation.error, retry: true, validation_failed: true }
        }
      }

      const oldValue = {
        status: camp.effective_status,
        daily_budget: camp.daily_budget,
        spend_today: camp.spend_today,
        care_pct_today: camp.care_pct_today,
      }
      const suggestedValue = args.action === "set_budget"
        ? { daily_budget: args.suggested_daily_budget }
        : args.action === "pause" ? { status: "PAUSED" } : null

      // Auto execute check
      let status = "pending"
      let fbResp: any = null
      let executedAt: string | null = null

      if (args.action !== "no_action") {
        const doAuto = await canAutoExecute(args.campaign_id, args.action, args.suggested_daily_budget, camp.mkt_name, sql)
        if (doAuto) {
          let fbPath = ""
          if (args.action === "pause") fbPath = `/${args.campaign_id}?status=PAUSED`
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
           (run_id, campaign_id, campaign_name, mkt_name, action, reason, old_value, suggested_value, confidence, status, executed_at, fb_response, agent_model, validation_retries)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14)`,
        [runId, args.campaign_id, camp.campaign_name, camp.mkt_name,
         args.action, args.reason, JSON.stringify(oldValue),
         JSON.stringify(suggestedValue), args.confidence ?? "medium",
         status, executedAt, JSON.stringify(fbResp), activeModel,
         validationRetries[args.campaign_id] ?? 0]
      ).catch((e: any) => logger?.error?.("[CampAI] insert rec fail:", e.message))

      return { ok: true, status, campaign_name: camp.campaign_name }
    }

    if (name === "update_recommendation") {
      await sql.sql(
        `UPDATE agent_camp_recommendation SET reason = $1, confidence = COALESCE($2, confidence) WHERE id = $3 AND run_id = $4`,
        [args.new_reason, args.new_confidence ?? null, args.rec_id, runId]
      ).catch((e: any) => logger?.error?.("[CampAI] update rec fail:", e.message))
      return { ok: true }
    }

    return { error: `Unknown tool: ${name}` }
  }

  // Agentic loop
  const mktCtx = opts?.mkt ? `MKT ${opts.mkt}` : "tất cả MKT"
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Hôm nay ${today}. Phân tích ${mktCtx} — camp active trong 14 ngày gần nhất. Tập trung camp đang ACTIVE có care_pct > 30% hoặc CPM cao bất thường. Đầu tiên gọi get_recent_rejections cho MKT đang xử lý để biết những action đã bị từ chối — không suggest lại với cùng campaign + action. Gọi recommend_action cho mỗi camp đã phân tích.`,
    },
  ]

  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  const MAX_ITERATIONS = 10

  for (let i = 0; i < MAX_ITERATIONS; i++) {
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

    if (!msg.tool_calls?.length) break

    // Process all tool calls
    for (const tc of msg.tool_calls) {
      let args: any = {}
      try { args = JSON.parse(tc.function.arguments) } catch { /* ignore */ }
      const result = await handleTool(tc.function.name, args)
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      } as OpenAI.Chat.ChatCompletionMessageParam)
    }
  }

  // Phase D: Self-reflection loop
  const myRecs = await sql.sql(
    `SELECT id, campaign_id, campaign_name, action, reason, confidence FROM agent_camp_recommendation WHERE run_id = $1`,
    [runId]
  ).catch(() => [])

  if (myRecs.length > 0) {
    messages.push({
      role: "user",
      content: `Tự critique ${myRecs.length} recommendations vừa tạo:
${myRecs.map((r: any, i: number) => `${i + 1}. [${r.id}] [${r.action}] ${r.campaign_name}: "${r.reason}" (confidence: ${r.confidence})`).join("\n")}

Với mỗi rec, đánh giá:
- Reason có KPI cụ thể (số liệu) không?
- Action có khớp logic không (vd pause camp < 3 ngày là sai)?
- Confidence có hợp lý không?

Nếu rec nào cần sửa, gọi update_recommendation(rec_id, new_reason, new_confidence).
Nếu tất cả OK, trả lời "APPROVED" và dừng.`,
    })

    const reflectionTools = [...TOOLS, UPDATE_REC_TOOL]
    for (let i = 0; i < 3; i++) {
      const refRes = await client.chat.completions.create({
        model: activeModel,
        messages,
        tools: reflectionTools,
        tool_choice: "auto",
        max_tokens: 2000,
        temperature: 0.1,
      })
      const refMsg = refRes.choices[0].message
      messages.push(refMsg)
      totalPromptTokens += refRes.usage?.prompt_tokens ?? 0
      totalCompletionTokens += refRes.usage?.completion_tokens ?? 0

      if (!refMsg.tool_calls?.length) break

      for (const tc of refMsg.tool_calls) {
        let args: any = {}
        try { args = JSON.parse(tc.function.arguments) } catch { /* ignore */ }
        const result = await handleTool(tc.function.name, args)
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        } as OpenAI.Chat.ChatCompletionMessageParam)
      }
    }
    logger?.info?.(`[CampAI] Self-reflection done for run ${runId}`)
  }

  // Phase E: Evaluator agent (independent model)
  const recsForEval = await sql.sql(
    `SELECT id, campaign_id, campaign_name, action, reason, confidence FROM agent_camp_recommendation WHERE run_id = $1`,
    [runId]
  ).catch(() => [])

  if (recsForEval.length > 0) {
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
      const evaluation = JSON.parse(evalContent) as { evaluations?: Array<{ rec_id: string; pass: boolean; notes: string }> }

      if (evaluation.evaluations?.length) {
        for (const ev of evaluation.evaluations) {
          await sql.sql(
            `UPDATE agent_camp_recommendation SET reflection_passed = $1, reflection_notes = $2, evaluator_model = $3 WHERE id = $4 AND run_id = $5`,
            [ev.pass, ev.notes ?? null, EVALUATOR_MODEL, ev.rec_id, runId]
          ).catch(() => {})
        }
        logger?.info?.(`[CampAI] Evaluator done for run ${runId}, evaluated ${evaluation.evaluations.length} recs`)
      }
    } catch (evalErr: any) {
      logger?.warn?.(`[CampAI] Evaluator failed (non-blocking): ${evalErr.message}`)
    }
  }

  // Tính outcomes
  const recs = await sql.sql(`SELECT action, status FROM agent_camp_recommendation WHERE run_id = $1`, [runId]).catch(() => [])
  const outcomes = {
    total: recs.length,
    pause: recs.filter((r: any) => r.action === "pause").length,
    set_budget: recs.filter((r: any) => r.action === "set_budget").length,
    no_action: recs.filter((r: any) => r.action === "no_action").length,
    auto_executed: recs.filter((r: any) => r.status === "auto_executed").length,
  }

  // Log rollout cho ART training
  await sql.sql(
    `INSERT INTO agent_art_rollout (run_id, messages, tool_calls, rule_decisions, outcomes, model)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6)`,
    [runId, JSON.stringify(messages), JSON.stringify(toolCallLog),
     JSON.stringify(ruleDecisions), JSON.stringify(outcomes), activeModel]
  ).catch(() => {})

  logger?.info?.(`[CampAI] Run ${runId} done — ${outcomes.total} recs, ${outcomes.auto_executed} auto_exec, tokens=${totalPromptTokens}+${totalCompletionTokens}`)
  return { run_id: runId, outcomes }
}

export const config = {
  name: "camp-ai-care",
  schedule: "0 */2 * * *", // Mỗi 2 giờ
}
