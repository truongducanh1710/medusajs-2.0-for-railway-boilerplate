import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo } from "../../../camp-control/_lib"

function windowStart(window: string): string {
  const days = window === "2d" ? 2 : window === "3d" ? 3 : window === "7d" ? 7 : 1
  const d = new Date()
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 420)
  d.setDate(d.getDate() - (days - 1))
  return d.toISOString().slice(0, 10)
}

function todayVN(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 420)
  return d.toISOString().slice(0, 10)
}

// POST /admin/pancake-sync/report/care-rules/preview
// Dry-run: trả về camp sẽ bị ảnh hưởng nếu rule này được bật
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })

  const sql = req.scope.resolve("cskhAnalysisModule") as any
  const body = req.body as any

  const mktName = auth.isSuper && body.mkt_name ? body.mkt_name : auth.mktCode
  if (!mktName) return res.status(403).json({ error: "User chưa có MKT Code" })

  const { scope_type = "all", scope_value, conditions = [], condition_logic = "AND",
    rule_mode = "manual", product_key, time_window = "today", min_spend = 200000 } = body

  const from = windowStart(time_window)
  const to = todayVN()

  // Tìm camp theo scope
  let campQuery = `
    SELECT DISTINCT ON (campaign_id)
      campaign_id, campaign_name, mkt_name, effective_status, daily_budget, learning_stage
    FROM mkt_ads_cost
    WHERE mkt_name = $1 AND deleted_at IS NULL
      AND (date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $2::date - 7
  `
  const params: any[] = [mktName, to]

  if ((scope_type === "product" || scope_type === "campaign_name_like") && scope_value) {
    campQuery += ` AND campaign_name ILIKE $3`
    params.push(`%${scope_value}%`)
  } else if (scope_type === "campaign_ids" && scope_value) {
    const ids = scope_value.split(",").map((s: string) => s.trim())
    campQuery += ` AND campaign_id = ANY($3)`
    params.push(ids)
  }
  campQuery += ` ORDER BY campaign_id, date DESC`

  const camps: any[] = await sql(campQuery, params).catch(() => [])

  // Load threshold nếu Dạng B
  let threshold: any = null
  if (rule_mode === "smart_product" && product_key) {
    const [t] = await sql(`SELECT * FROM product_care_threshold WHERE product_key = $1`, [product_key]).catch(() => [])
    threshold = t ?? null
  }

  const results = []
  for (const camp of camps) {
    // Tính metric
    const [spendRow] = await sql(`
      SELECT COALESCE(SUM(spend),0)::bigint AS spend,
             COALESCE(MAX(daily_budget),0)::bigint AS daily_budget,
             MAX(learning_stage) AS learning_stage
      FROM mkt_ads_cost
      WHERE campaign_id = $1 AND mkt_name = $2
        AND (date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $3::date AND $4::date
    `, [camp.campaign_id, mktName, from, to]).catch(() => [{}])

    const [orderRow] = await sql(`
      SELECT COUNT(*)::int AS orders_real
      FROM pancake_order
      WHERE fb_campaign_id = $1 AND marketer_name = $2
        AND status IN (1,2,3,6,9)
        AND (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $3::date AND $4::date
        AND deleted_at IS NULL
    `, [camp.campaign_id, mktName, from, to]).catch(() => [{}])

    const spend = Number(spendRow?.spend ?? 0)
    const ordersReal = Number(orderRow?.orders_real ?? 0)
    const cprReal = ordersReal > 0 ? Math.round(spend / ordersReal) : null
    const metrics = { spend, orders_real: ordersReal, cpr_real: cprReal,
      learning_stage: spendRow?.learning_stage ?? "success" }

    if (spend < Number(min_spend)) continue

    let wouldMatch = false
    if (rule_mode === "smart_product" && threshold) {
      const isLearning = metrics.learning_stage === "LEARNING" || metrics.learning_stage === "LEARNING_LIMITED"
      const tgt = Number(threshold.target_cpr)
      if (isLearning) wouldMatch = spend > tgt * Number(threshold.new_camp_multiplier) && ordersReal === 0
      else if (cprReal !== null) wouldMatch = cprReal > tgt * Number(threshold.old_camp_warn_multiplier)
    } else {
      const logic = condition_logic === "OR" ? "OR" : "AND"
      const conds = (conditions as any[]).map((c: any) => {
        const val = (metrics as any)[c.metric]
        if (val === null || val === undefined) return false
        switch (c.op) {
          case ">": return val > c.value
          case ">=": return val >= c.value
          case "<": return val < c.value
          case "<=": return val <= c.value
          case "==": return val === c.value
          default: return false
        }
      })
      wouldMatch = conds.length > 0 && (logic === "OR" ? conds.some(Boolean) : conds.every(Boolean))
    }

    if (wouldMatch) {
      results.push({ campaign_id: camp.campaign_id, campaign_name: camp.campaign_name,
        effective_status: camp.effective_status, metrics })
    }
  }

  return res.json({ affected_camps: results, total: results.length })
}
