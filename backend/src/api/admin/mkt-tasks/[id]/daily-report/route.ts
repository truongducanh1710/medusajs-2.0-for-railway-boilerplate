import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../../lib/db"
import { resolveUserPerms } from "../../../../middlewares"

function normalizeEmail(value: any): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function normalizeMktName(value: any): string {
  return typeof value === "string" ? value.trim().toUpperCase() : ""
}

async function sql(query: string, params?: any[]): Promise<any[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(query, params ?? [])
    return result.rows
  } finally {
    client.release()
  }
}

async function buildDailyMktRows(date: string) {
  const mktExpr = `
    CASE UPPER(TRIM(COALESCE(NULLIF(TRIM(raw->'marketer'->>'name'), ''), '')))
      WHEN 'NAM DV'     THEN 'NAMDV'
      WHEN 'PHẠM DU'    THEN 'DUPD'
      WHEN 'NGUYỄN MAI' THEN 'NGUYEN MAI'
      WHEN 'TRUONGAN'   THEN 'ANHTD'
      WHEN ''           THEN NULL
      ELSE UPPER(TRIM(NULLIF(TRIM(raw->'marketer'->>'name'), '')))
    END
  `

  const mktRaw = `
    COALESCE(
      ${mktExpr},
      CASE
        WHEN raw->>'p_utm_campaign' LIKE '%\\_%\\_%'
          THEN split_part(raw->>'p_utm_campaign', '_', 2)
        WHEN raw->>'p_utm_source' LIKE '%\\_%\\_%'
          THEN split_part(raw->>'p_utm_source', '_', 2)
        ELSE 'KHÁC'
      END
    )
  `

  const mktWithFallback = `
    CASE WHEN ${mktRaw} = 'TRUONGAN' THEN 'ANHTD' ELSE ${mktRaw} END
  `

  let handoverRules: { from_code: string; to_code: string; effective_from: string; effective_to: string | null }[] = []
  try {
    handoverRules = await sql(
      `SELECT from_code, to_code, effective_from::text, effective_to::text FROM mkt_handover WHERE deleted_at IS NULL`
    )
  } catch { /* bảng handover là optional */ }

  const rows = await sql(`
    SELECT
      COALESCE(r.date, c.date, g.date) AS date,
      COALESCE(r.mkt_name, c.mkt_name, g.mkt_name) AS mkt_name,
      COALESCE(r.total_orders, 0) AS total_orders,
      COALESCE(r.delivered, 0) AS delivered,
      COALESCE(r.new_orders, 0) AS new_orders,
      COALESCE(r.confirmed, 0) AS confirmed,
      COALESCE(r.cancelled, 0) AS cancelled,
      COALESCE(r.pending, 0) AS pending,
      COALESCE(r.revenue_total, 0) AS revenue_total,
      COALESCE(r.revenue_delivered, 0) AS revenue_delivered,
      COALESCE(r.cod_total, 0) AS cod_total,
      (COALESCE(c.spend, 0) + COALESCE(g.cost, 0))::bigint AS ads_cost,
      CASE
        WHEN COALESCE(r.revenue_total, 0) > 0
        THEN ROUND((COALESCE(c.spend, 0) + COALESCE(g.cost, 0))::numeric / r.revenue_total * 100, 2)
        ELSE NULL
      END AS care_pct
    FROM (
      SELECT
        to_char(date_trunc('day', pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS date,
        ${mktWithFallback} AS mkt_name,
        COUNT(*)::int AS total_orders,
        SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END)::int AS delivered,
        SUM(CASE WHEN status IN (6, 7, -1, -2) THEN 1 ELSE 0 END)::int AS cancelled,
        SUM(CASE WHEN status NOT IN (3, 6, 7, -1, -2) THEN 1 ELSE 0 END)::int AS pending,
        SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END)::int AS new_orders,
        SUM(CASE WHEN status IN (1, 2, 4, 5, 9, 11) THEN 1 ELSE 0 END)::int AS confirmed,
        SUM(CASE WHEN status NOT IN (-2, 7) THEN GREATEST(cod_amount, total::bigint) ELSE 0 END)::bigint AS revenue_total,
        SUM(CASE WHEN status = 3 THEN GREATEST(cod_amount, total::bigint) ELSE 0 END)::bigint AS revenue_delivered,
        SUM(CASE WHEN status NOT IN (-2, 7) THEN cod_amount ELSE 0 END)::bigint AS cod_total
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
        AND NOT (tags @> '[{"name": "Đơn nháp"}]'::jsonb)
        AND NOT (tags @> '[{"name": "Đơn trùng"}]'::jsonb)
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($1::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      GROUP BY date, mkt_name
    ) r
    FULL OUTER JOIN (
      SELECT
        to_char(date_trunc('day', date), 'YYYY-MM-DD') AS date,
        mkt_name,
        SUM(spend)::bigint AS spend
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL
        AND date = $1::date
      GROUP BY date_trunc('day', date), mkt_name
    ) c ON c.date = r.date AND c.mkt_name = r.mkt_name
    FULL OUTER JOIN (
      SELECT
        to_char(date_trunc('day', date), 'YYYY-MM-DD') AS date,
        mkt_name,
        SUM(cost)::bigint AS cost
      FROM mkt_ads_cost_gg
      WHERE deleted_at IS NULL
        AND date = $1::date
      GROUP BY date_trunc('day', date), mkt_name
    ) g ON g.date = COALESCE(r.date, c.date) AND g.mkt_name = COALESCE(r.mkt_name, c.mkt_name)
    ORDER BY COALESCE(r.date, c.date, g.date) DESC, COALESCE(r.revenue_total, 0) DESC
  `, [date])

  for (const row of rows) {
    for (const rule of handoverRules) {
      if (
        row.mkt_name === rule.from_code &&
        row.date >= rule.effective_from &&
        (!rule.effective_to || row.date <= rule.effective_to)
      ) {
        row.mkt_name = rule.to_code
        break
      }
    }
  }

  const mergedMap: Record<string, any> = {}
  for (const row of rows) {
    const key = `${row.date}__${row.mkt_name}`
    if (!mergedMap[key]) {
      mergedMap[key] = { ...row }
      continue
    }
    const m = mergedMap[key]
    m.total_orders += row.total_orders
    m.delivered += row.delivered
    m.new_orders += row.new_orders
    m.confirmed += row.confirmed
    m.cancelled += row.cancelled
    m.pending += row.pending
    m.revenue_total = Number(m.revenue_total) + Number(row.revenue_total)
    m.revenue_delivered = Number(m.revenue_delivered) + Number(row.revenue_delivered)
    m.cod_total = Number(m.cod_total) + Number(row.cod_total)
    m.ads_cost = Number(m.ads_cost) + Number(row.ads_cost)
    m.care_pct = m.revenue_total > 0 ? Math.round(m.ads_cost / m.revenue_total * 10000) / 100 : null
  }

  return Object.values(mergedMap)
}

function emptyReport(date: string, mktName: string) {
  return {
    date,
    mkt_name: mktName,
    total_orders: 0,
    delivered: 0,
    new_orders: 0,
    confirmed: 0,
    cancelled: 0,
    pending: 0,
    revenue_total: 0,
    revenue_delivered: 0,
    cod_total: 0,
    ads_cost: 0,
    care_pct: 0,
  }
}

// GET /admin/mkt-tasks/:id/daily-report?date=YYYY-MM-DD
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = (req as any).auth_context
    if (auth?.actor_type !== "user" || !auth?.actor_id) {
      return res.status(401).json({ error: "Unauthenticated" })
    }

    const { id } = req.params
    const { date } = req.query as any
    const dateKey = String(date || "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return res.status(400).json({ error: "date phải có dạng YYYY-MM-DD" })
    }

    const userModule = req.scope.resolve(Modules.USER)
    const user = await userModule.retrieveUser(auth.actor_id, { select: ["email", "metadata"] })
    const email = user?.email || ""

    const svc = req.scope.resolve("mktTaskModule") as any
    const [task] = await svc.listMktTasks({ id, deleted_at: null })
    if (!task) return res.status(404).json({ error: "Không tìm thấy task" })

    const perms = resolveUserPerms(user.metadata)
    const isManager = email === process.env.SUPER_ADMIN_EMAIL || perms.includes("page.mkt-tasks.manage")
    if (!isManager && normalizeEmail(task.assignee_id) !== normalizeEmail(email)) {
      return res.status(403).json({ error: "Không có quyền xem báo cáo của task này" })
    }

    // mkt_name lấy theo người được giao task (assignee), không phải người đang xem
    const [assignee] = await userModule.listUsers(
      { email: task.assignee_id },
      { select: ["email", "metadata"] }
    )
    const assigneeMetadata = (assignee?.metadata || {}) as any
    const mktName = normalizeMktName(assigneeMetadata.mkt_name || assigneeMetadata.mkt_code)
    if (!mktName) {
      return res.status(403).json({ error: `Nhân sự phụ trách task (${task.assignee_id}) chưa được gán mkt_name, liên hệ quản lý` })
    }

    const rows = await buildDailyMktRows(dateKey)
    const report = rows.find((r: any) => normalizeMktName(r.mkt_name) === mktName) || emptyReport(dateKey, mktName)

    return res.json({ report, date: dateKey, mkt_name: mktName })
  } catch (err: any) {
    console.error("[mkt-tasks/daily-report]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
