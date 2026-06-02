import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo } from "../camp-control/_lib"

// GET /admin/pancake-sync/report/care-rules
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })

  const sql = req.scope.resolve("cskhAnalysisModule") as any
  const { mkt } = req.query as any

  let query = `
    SELECT r.*,
      (SELECT MAX(created_at) FROM mkt_care_rule_log l WHERE l.rule_id = r.id AND l.action_taken NOT IN ('not_matched','below_min_spend','skipped_cooldown','blocked_permission')) AS last_triggered_at,
      (SELECT action_taken FROM mkt_care_rule_log l WHERE l.rule_id = r.id ORDER BY created_at DESC LIMIT 1) AS last_action
    FROM mkt_care_rule r
    WHERE r.deleted_at IS NULL
  `
  const params: any[] = []

  if (!auth.isSuper) {
    if (!auth.mktCode) return res.status(403).json({ error: "User chưa có MKT Code" })
    query += ` AND r.mkt_name = $${params.length + 1}`
    params.push(auth.mktCode)
  } else if (mkt) {
    query += ` AND r.mkt_name = $${params.length + 1}`
    params.push(mkt)
  }

  query += ` ORDER BY r.created_at DESC`
  const rules = await sql(query, params).catch(() => [])
  return res.json({ rules })
}

// POST /admin/pancake-sync/report/care-rules
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })

  const body = req.body as any
  const sql = req.scope.resolve("cskhAnalysisModule") as any

  // Phân quyền tầng 1: mkt_name luôn = mktCode của user (trừ super)
  const mktName = auth.isSuper && body.mkt_name ? body.mkt_name : auth.mktCode
  if (!mktName) return res.status(403).json({ error: "User chưa có MKT Code" })

  const { name, rule_mode = "manual", scope_type = "all", scope_value, conditions,
    condition_logic = "AND", product_key, time_window = "today", action,
    action_payload, check_schedule = "hourly", min_spend = 200000, cooldown_hours = 12 } = body

  if (!name?.trim()) return res.status(400).json({ error: "Cần tên rule" })
  if (!action) return res.status(400).json({ error: "Cần action" })

  const [rule] = await sql(`
    INSERT INTO mkt_care_rule
      (name, mkt_name, rule_mode, scope_type, scope_value, conditions, condition_logic,
       product_key, time_window, action, action_payload, check_schedule, min_spend, cooldown_hours, created_by_email)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
    RETURNING *
  `, [name.trim(), mktName, rule_mode, scope_type, scope_value ?? null,
      JSON.stringify(conditions ?? []), condition_logic,
      product_key ?? null, time_window, action,
      JSON.stringify(action_payload ?? {}), check_schedule,
      min_spend, cooldown_hours, auth.email])

  return res.status(201).json({ rule })
}
