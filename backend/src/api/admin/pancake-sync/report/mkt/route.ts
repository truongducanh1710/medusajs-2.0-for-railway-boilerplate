import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
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

/**
 * GET /admin/pancake-sync/report/mkt?from=2026-05-01&to=2026-05-31&group_by=day
 * Báo cáo doanh số + chi phí theo MKT — marketer->name từ Pancake POS, fallback UTM.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      group_by = "day",
    } = req.query as Record<string, string>

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const truncUnit = group_by === "month" ? "month" : "day"

    // Normalize tên marketer Pancake → MKT code (khớp với campaign name FB Ads)
    // raw->'marketer'->>'name' trả về tên hiển thị có space/dấu (VD: "Nam DV", "Phạm Du")
    // cần map về code viết tắt để JOIN được với mkt_ads_cost
    const mktExpr = `
      CASE UPPER(TRIM(COALESCE(NULLIF(TRIM(raw->'marketer'->>'name'), ''), '')))
        WHEN 'NAM DV'     THEN 'NAMDV'
        WHEN 'PHẠM DU'    THEN 'DUPD'
        WHEN 'NGUYỄN MAI' THEN 'NGUYEN MAI'
        WHEN ''           THEN NULL
        ELSE UPPER(TRIM(NULLIF(TRIM(raw->'marketer'->>'name'), '')))
      END
    `

    // Fallback UTM nếu marketer name null
    const mktWithFallback = `
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

    // Load handover rules — áp dụng khi tính attribution theo ngày
    let handoverRules: { from_code: string; to_code: string; effective_from: string }[] = []
    try {
      handoverRules = await sql(
        `SELECT from_code, to_code, effective_from::text FROM mkt_handover WHERE deleted_at IS NULL`
      )
    } catch { /* ignore nếu bảng chưa tồn tại */ }

    const rows = await sql(`
      SELECT
        COALESCE(r.date, c.date) AS date,
        COALESCE(r.mkt_name, c.mkt_name) AS mkt_name,
        COALESCE(r.total_orders, 0) AS total_orders,
        COALESCE(r.delivered, 0) AS delivered,
        COALESCE(r.new_orders, 0) AS new_orders,
        COALESCE(r.confirmed, 0) AS confirmed,
        COALESCE(r.cancelled, 0) AS cancelled,
        COALESCE(r.pending, 0) AS pending,
        COALESCE(r.revenue_total, 0) AS revenue_total,
        COALESCE(r.revenue_delivered, 0) AS revenue_delivered,
        COALESCE(r.cod_total, 0) AS cod_total,
        COALESCE(c.spend, 0)::bigint AS ads_cost,
        CASE
          WHEN COALESCE(r.revenue_total, 0) > 0
          THEN ROUND(COALESCE(c.spend, 0)::numeric / r.revenue_total * 100, 2)
          ELSE NULL
        END AS care_pct
      FROM (
        SELECT
          to_char(date_trunc('${truncUnit}', pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS date,
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
          AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        GROUP BY date, mkt_name
      ) r
      FULL OUTER JOIN (
        SELECT
          to_char(date_trunc('${truncUnit}', date), 'YYYY-MM-DD') AS date,
          mkt_name,
          SUM(spend)::bigint AS spend
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND date >= $1::date
          AND date <= $2::date
        GROUP BY date_trunc('${truncUnit}', date), mkt_name
      ) c ON c.date = r.date AND c.mkt_name = r.mkt_name
      ORDER BY COALESCE(r.date, c.date) DESC, COALESCE(r.revenue_total, 0) DESC
    `, [`${from}T00:00:00Z`, to])

    // Apply handover rules: nếu date >= effective_from thì đổi mkt_name
    for (const row of rows) {
      for (const rule of handoverRules) {
        if (row.mkt_name === rule.from_code && row.date >= rule.effective_from) {
          row.mkt_name = rule.to_code
          break
        }
      }
    }

    // Merge rows cùng date + mkt_name (xảy ra khi handover tạo ra duplicate)
    const mergedMap: Record<string, any> = {}
    for (const row of rows) {
      const key = `${row.date}__${row.mkt_name}`
      if (!mergedMap[key]) {
        mergedMap[key] = { ...row }
      } else {
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
    }
    const mergedRows = Object.values(mergedMap)

    // Build summary per MKT
    const summary: Record<string, any> = {}
    for (const row of mergedRows) {
      const m = row.mkt_name
      if (!summary[m]) {
        summary[m] = { total_orders: 0, delivered: 0, new_orders: 0, confirmed: 0, cancelled: 0, revenue_total: 0, revenue_delivered: 0, ads_cost: 0 }
      }
      summary[m].total_orders += row.total_orders
      summary[m].delivered += row.delivered
      summary[m].cancelled += row.cancelled
      summary[m].new_orders += row.new_orders
      summary[m].confirmed += row.confirmed
      summary[m].revenue_total += Number(row.revenue_total)
      summary[m].revenue_delivered += Number(row.revenue_delivered)
      summary[m].ads_cost += Number(row.ads_cost)
    }

    // Tính care_pct tổng per MKT (dựa trên revenue_total = tất cả trừ hủy)
    for (const m of Object.keys(summary)) {
      const s = summary[m]
      s.care_pct = s.revenue_total > 0
        ? Math.round(s.ads_cost / s.revenue_total * 10000) / 100
        : null
    }

    return res.json({ rows: mergedRows, summary, from, to, group_by })
  } catch (err: any) {
    console.error("[report/mkt]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
