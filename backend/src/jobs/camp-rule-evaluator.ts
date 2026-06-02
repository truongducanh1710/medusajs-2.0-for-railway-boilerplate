import { MedusaContainer } from "@medusajs/framework"
import { notifyTelegram, formatRuleAlert } from "../lib/notify"

const FB_API_BASE = "https://graph.facebook.com/v18.0"

// Giờ VN (UTC+7)
function nowVN(): Date {
  const d = new Date()
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 420)
  return d
}

function todayVN(): string {
  return nowVN().toISOString().slice(0, 10)
}

function windowStart(window: string): string {
  const days = window === "2d" ? 2 : window === "3d" ? 3 : window === "7d" ? 7 : 1
  const d = nowVN()
  d.setDate(d.getDate() - (days - 1))
  return d.toISOString().slice(0, 10)
}

// Check cron tick theo VN hour
function shouldRun(checkSchedule: string, hourVN: number): boolean {
  if (checkSchedule === "hourly") return true
  if (checkSchedule === "every_4h") return hourVN % 4 === 0
  if (checkSchedule === "daily_7h") return hourVN === 7
  return true
}

async function callFb(path: string): Promise<{ ok: boolean; data: any }> {
  const token = process.env.FB_ACCESS_TOKEN || ""
  try {
    const res = await fetch(`${FB_API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${token}`)
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok && !data?.error, data }
  } catch (e: any) {
    return { ok: false, data: { error: { message: e.message } } }
  }
}

function evalCondition(value: number | null, op: string, threshold: number): boolean {
  if (value === null) return false
  switch (op) {
    case ">":  return value > threshold
    case ">=": return value >= threshold
    case "<":  return value < threshold
    case "<=": return value <= threshold
    case "==": return value === threshold
    default:   return false
  }
}

async function getMetrics(sql: any, campaignId: string, mktName: string, timeWindow: string) {
  const from = windowStart(timeWindow)
  const to = todayVN()

  const [spendRow] = await sql(`
    SELECT
      COALESCE(SUM(spend),0)::bigint AS spend,
      COALESCE(SUM(impressions),0)::int AS impressions,
      COALESCE(SUM(clicks),0)::int AS clicks,
      COALESCE(MAX(daily_budget),0)::bigint AS daily_budget,
      MAX(effective_status) AS effective_status,
      MAX(learning_stage) AS learning_stage
    FROM mkt_ads_cost
    WHERE campaign_id = $1
      AND mkt_name = $2
      AND (date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $3::date AND $4::date
  `, [campaignId, mktName, from, to]).catch(() => [{}])

  const [orderRow] = await sql(`
    SELECT
      COUNT(*)::int AS orders_real,
      COUNT(*) FILTER (WHERE status = 3)::int AS orders_delivered,
      COALESCE(SUM(total) FILTER (WHERE status = 3),0)::bigint AS revenue_real
    FROM pancake_order
    WHERE fb_campaign_id = $1
      AND marketer_name = $2
      AND status IN (1,2,3,6,9)
      AND (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $3::date AND $4::date
      AND deleted_at IS NULL
  `, [campaignId, mktName, from, to]).catch(() => [{}])

  const spend = Number(spendRow?.spend ?? 0)
  const ordersReal = Number(orderRow?.orders_real ?? 0)
  const cprReal = ordersReal > 0 ? Math.round(spend / ordersReal) : null
  const impressions = Number(spendRow?.impressions ?? 0)
  const clicks = Number(spendRow?.clicks ?? 0)

  return {
    spend,
    orders_real: ordersReal,
    orders_delivered: Number(orderRow?.orders_delivered ?? 0),
    revenue_real: Number(orderRow?.revenue_real ?? 0),
    cpr_real: cprReal,
    cpm: impressions > 0 ? Math.round(spend / impressions * 1000) : null,
    ctr: impressions > 0 ? Math.round(clicks / impressions * 10000) / 100 : null,
    daily_budget: Number(spendRow?.daily_budget ?? 0),
    effective_status: spendRow?.effective_status ?? null,
    learning_stage: spendRow?.learning_stage ?? "success",
  }
}

function evalManualRule(rule: any, metrics: any): boolean {
  const conditions: any[] = rule.conditions ?? []
  if (!conditions.length) return false
  const logic = rule.condition_logic === "OR" ? "OR" : "AND"
  const results = conditions.map((c: any) => {
    const val = metrics[c.metric as keyof typeof metrics] as number | null
    return evalCondition(val, c.op, Number(c.value))
  })
  return logic === "OR" ? results.some(Boolean) : results.every(Boolean)
}

function evalSmartRule(rule: any, metrics: any, threshold: any): { matched: boolean; action: string; payload: any } {
  const isLearning = metrics.learning_stage === "LEARNING" || metrics.learning_stage === "LEARNING_LIMITED"
  const tgt = Number(threshold?.target_cpr ?? 150000)

  if (isLearning) {
    const mult = Number(threshold?.new_camp_multiplier ?? 2.0)
    const matched = metrics.spend > tgt * mult && metrics.orders_real === 0
    return { matched, action: "pause", payload: null }
  }

  // Đã thoát learning
  if (metrics.cpr_real === null) return { matched: false, action: "notify", payload: null }
  const killMult = Number(threshold?.old_camp_kill_multiplier ?? 2.0)
  const warnMult = Number(threshold?.old_camp_warn_multiplier ?? 1.5)
  if (metrics.cpr_real > tgt * killMult) {
    return { matched: true, action: "pause", payload: null }
  }
  if (metrics.cpr_real > tgt * warnMult) {
    const pct = -30
    const newBudget = Math.max(50000, Math.round(metrics.daily_budget * (1 + pct / 100)))
    return { matched: true, action: "set_budget_abs", payload: { daily_budget: newBudget } }
  }
  return { matched: false, action: "notify", payload: null }
}

export default async function campRuleEvaluator(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const sql = container.resolve("cskhAnalysisModule") as any

  const hourVN = nowVN().getHours()

  // Lấy rule active, lọc theo check_schedule phù hợp giờ hiện tại
  const rules: any[] = await sql(`
    SELECT * FROM mkt_care_rule
    WHERE enabled = true AND deleted_at IS NULL
    ORDER BY created_at ASC
  `).catch(() => [])

  const eligibleRules = rules.filter((r: any) => shouldRun(r.check_schedule, hourVN))
  if (!eligibleRules.length) return

  logger?.info?.(`[RuleEvaluator] ${eligibleRules.length} rules to check at VN hour ${hourVN}`)

  for (const rule of eligibleRules) {
    // Tìm camp thuộc đúng mkt của rule (PHÂN QUYỀN TẦNG 2)
    let campQuery = `
      SELECT DISTINCT ON (campaign_id)
        campaign_id, campaign_name, mkt_name, effective_status, daily_budget, learning_stage
      FROM mkt_ads_cost
      WHERE mkt_name = $1
        AND deleted_at IS NULL
        AND (date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $2::date - 7
    `
    const params: any[] = [rule.mkt_name, todayVN()]

    if (rule.scope_type === "product" && rule.scope_value) {
      campQuery += ` AND campaign_name ILIKE $3`
      params.push(`%${rule.scope_value}%`)
    } else if (rule.scope_type === "campaign_name_like" && rule.scope_value) {
      campQuery += ` AND campaign_name ILIKE $3`
      params.push(`%${rule.scope_value}%`)
    } else if (rule.scope_type === "campaign_ids" && rule.scope_value) {
      const ids = rule.scope_value.split(",").map((s: string) => s.trim()).filter(Boolean)
      campQuery += ` AND campaign_id = ANY($3)`
      params.push(ids)
    } else if (rule.scope_type === "account" && rule.scope_value) {
      campQuery += ` AND ad_account_id = $3`
      params.push(rule.scope_value)
    }

    campQuery += ` ORDER BY campaign_id, date DESC`

    const camps: any[] = await sql(campQuery, params).catch(() => [])

    // Load product threshold nếu Dạng B
    let threshold: any = null
    if (rule.rule_mode === "smart_product" && rule.product_key) {
      const [t] = await sql(
        `SELECT * FROM product_care_threshold WHERE product_key = $1`,
        [rule.product_key]
      ).catch(() => [])
      threshold = t ?? null
    }

    for (const camp of camps) {
      // ⚠️ PHÂN QUYỀN: double-check mkt_name khớp (tránh data anomaly)
      if (camp.mkt_name !== rule.mkt_name) {
        await sql(
          `INSERT INTO mkt_care_rule_log (rule_id, campaign_id, campaign_name, matched, metrics_snapshot, action_taken)
           VALUES ($1, $2, $3, false, '{}', 'blocked_permission')`,
          [rule.id, camp.campaign_id, camp.campaign_name]
        ).catch(() => {})
        logger?.warn?.(`[RuleEvaluator] blocked_permission: rule ${rule.id} tried camp ${camp.campaign_id} (mkt=${camp.mkt_name})`)
        continue
      }

      const metrics = await getMetrics(sql, camp.campaign_id, rule.mkt_name, rule.time_window)

      // Guard: min_spend
      if (metrics.spend < Number(rule.min_spend ?? 200000)) {
        await sql(
          `INSERT INTO mkt_care_rule_log (rule_id, campaign_id, campaign_name, matched, metrics_snapshot, action_taken)
           VALUES ($1, $2, $3, false, $4::jsonb, 'below_min_spend')`,
          [rule.id, camp.campaign_id, camp.campaign_name, JSON.stringify(metrics)]
        ).catch(() => {})
        continue
      }

      // Guard: cooldown
      const [lastLog] = await sql(`
        SELECT created_at FROM mkt_care_rule_log
        WHERE rule_id = $1 AND campaign_id = $2
          AND action_taken NOT IN ('below_min_spend', 'blocked_permission', 'not_matched')
          AND created_at > now() - ($3 || ' hours')::interval
        ORDER BY created_at DESC LIMIT 1
      `, [rule.id, camp.campaign_id, rule.cooldown_hours ?? 12]).catch(() => [])

      if (lastLog) {
        await sql(
          `INSERT INTO mkt_care_rule_log (rule_id, campaign_id, campaign_name, matched, metrics_snapshot, action_taken)
           VALUES ($1, $2, $3, false, $4::jsonb, 'skipped_cooldown')`,
          [rule.id, camp.campaign_id, camp.campaign_name, JSON.stringify(metrics)]
        ).catch(() => {})
        continue
      }

      // Đánh giá điều kiện
      let matched = false
      let action = rule.action
      let actionPayload = rule.action_payload

      if (rule.rule_mode === "smart_product") {
        if (!threshold) continue
        const result = evalSmartRule(rule, metrics, threshold)
        matched = result.matched
        action = result.action
        actionPayload = result.payload
      } else {
        matched = evalManualRule(rule, metrics)
      }

      if (!matched) {
        await sql(
          `INSERT INTO mkt_care_rule_log (rule_id, campaign_id, campaign_name, matched, metrics_snapshot, action_taken)
           VALUES ($1, $2, $3, false, $4::jsonb, 'not_matched')`,
          [rule.id, camp.campaign_id, camp.campaign_name, JSON.stringify(metrics)]
        ).catch(() => {})
        continue
      }

      // Thực thi action
      let scheduleId: string | null = null

      if (action === "notify") {
        // Chỉ gửi Telegram, không tạo schedule
        await notifyTelegram(formatRuleAlert({
          ruleName: rule.name, mktName: rule.mkt_name,
          campName: camp.campaign_name, action, metrics, actionDone: false,
        }))
      } else {
        // Tính payload cho set_budget_pct
        if (action === "set_budget_pct") {
          const pct = Math.max(-50, Math.min(50, Number(actionPayload?.pct ?? -30)))
          const currentBudget = metrics.daily_budget || Number(camp.daily_budget) || 300000
          const newBudget = Math.max(50000, Math.min(50000000, Math.round(currentBudget * (1 + pct / 100))))
          action = "set_budget"
          actionPayload = { daily_budget: newBudget }
        } else if (action === "set_budget_abs") {
          action = "set_budget"
        }

        // INSERT camp_schedule — executor sẽ chạy trong 1 phút
        const [inserted] = await sql(`
          INSERT INTO camp_schedule (campaign_id, campaign_name, action, payload, scheduled_at, created_by_email)
          VALUES ($1, $2, $3, $4::jsonb, now(), $5)
          RETURNING id
        `, [
          camp.campaign_id, camp.campaign_name, action,
          JSON.stringify(actionPayload ?? {}),
          rule.created_by_email,
        ]).catch(() => [])

        scheduleId = inserted?.id ?? null

        // Bắn Telegram thông báo
        await notifyTelegram(formatRuleAlert({
          ruleName: rule.name, mktName: rule.mkt_name,
          campName: camp.campaign_name, action, metrics, actionDone: true,
        }))

        logger?.info?.(`[RuleEvaluator] ✓ rule="${rule.name}" camp="${camp.campaign_name}" action=${action}`)
      }

      await sql(`
        INSERT INTO mkt_care_rule_log (rule_id, campaign_id, campaign_name, matched, metrics_snapshot, action_taken, schedule_id)
        VALUES ($1, $2, $3, true, $4::jsonb, $5, $6)
      `, [rule.id, camp.campaign_id, camp.campaign_name, JSON.stringify(metrics), action, scheduleId]).catch(() => {})
    }
  }
}

export const config = {
  name: "camp-rule-evaluator",
  schedule: "0 * * * *",  // Mỗi giờ — rule tự lọc theo check_schedule
}
