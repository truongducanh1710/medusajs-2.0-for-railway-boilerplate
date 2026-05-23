import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/mkt?from=2026-05-01&to=2026-05-31&group_by=day
 * Báo cáo doanh số theo MKT — extract từ UTM campaign/source trong raw field.
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

    // Extract MKT name từ UTM: format "DD/MM_TÊNMKT_SẢN PHẨM_..." → lấy token thứ 2
    const mktExpr = `
      UPPER(TRIM(
        CASE
          WHEN raw->>'p_utm_campaign' LIKE '%\\_%\\_%'
            THEN split_part(raw->>'p_utm_campaign', '_', 2)
          WHEN raw->>'p_utm_source' LIKE '%\\_%\\_%'
            THEN split_part(raw->>'p_utm_source', '_', 2)
          ELSE 'KHÁC'
        END
      ))
    `

    const rows = await cskhService.sql(`
      SELECT
        date_trunc('${truncUnit}', pancake_created_at)::date AS date,
        ${mktExpr} AS mkt_name,
        COUNT(*)::int AS total_orders,
        SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END)::int AS delivered,
        SUM(CASE WHEN status IN (6, 7, -1, -2) THEN 1 ELSE 0 END)::int AS cancelled,
        SUM(CASE WHEN status NOT IN (3, 6, 7, -1, -2) THEN 1 ELSE 0 END)::int AS pending,
        SUM(total)::bigint AS revenue_total,
        SUM(CASE WHEN status = 3 THEN total ELSE 0 END)::bigint AS revenue_delivered,
        SUM(cod_amount)::bigint AS cod_total
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND source IN ('manual', 'webcake')
        AND pancake_created_at >= $1
        AND pancake_created_at < ($2::date + interval '1 day')
      GROUP BY date, mkt_name
      ORDER BY date DESC, revenue_total DESC
    `, [`${from}T00:00:00Z`, to])

    // Build summary per MKT
    const summary: Record<string, any> = {}
    for (const row of rows) {
      const m = row.mkt_name
      if (!summary[m]) {
        summary[m] = { total_orders: 0, delivered: 0, cancelled: 0, pending: 0, revenue_total: 0, revenue_delivered: 0 }
      }
      summary[m].total_orders += row.total_orders
      summary[m].delivered += row.delivered
      summary[m].cancelled += row.cancelled
      summary[m].pending += row.pending
      summary[m].revenue_total += Number(row.revenue_total)
      summary[m].revenue_delivered += Number(row.revenue_delivered)
    }

    return res.json({ rows, summary, from, to, group_by })
  } catch (err: any) {
    console.error("[report/mkt]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
