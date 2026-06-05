import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/camp-control/all-logs
 * Query: mkt, user_email, action, from, to, limit=100, offset=0
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { mkt, user_email, action, from, to, limit = "100", offset = "0" } = req.query as Record<string, string>
    const lim = Math.min(Math.max(parseInt(limit) || 100, 1), 500)
    const off = Math.max(parseInt(offset) || 0, 0)

    const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any

    const conditions: string[] = []
    const params: any[] = []

    if (mkt) {
      const codes = mkt.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
      if (codes.length === 1) {
        params.push(`%_${codes[0]}_%`)
        conditions.push(`campaign_name ILIKE $${params.length}`)
      } else {
        const likeClauses = codes.map(c => { params.push(`%_${c}_%`); return `campaign_name ILIKE $${params.length}` })
        conditions.push(`(${likeClauses.join(" OR ")})`)
      }
    }
    if (user_email) {
      params.push(user_email)
      conditions.push(`user_email = $${params.length}`)
    }
    if (action) {
      params.push(action)
      conditions.push(`action = $${params.length}`)
    }
    if (from) {
      params.push(from)
      conditions.push(`created_at >= $${params.length}::date`)
    }
    if (to) {
      params.push(to)
      conditions.push(`created_at < ($${params.length}::date + interval '1 day')`)
    }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : ""
    params.push(lim, off)

    const logs = await sqlSvc.sql(
      `SELECT id, campaign_id, campaign_name, action, old_value, new_value,
              source, user_email, success, fb_response, created_at
       FROM camp_action_log
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ).catch(() => [])

    const countRows = await sqlSvc.sql(
      `SELECT COUNT(*)::int as total FROM camp_action_log ${where}`,
      params.slice(0, -2)
    ).catch(() => [{ total: 0 }])

    return res.json({ logs, total: countRows[0]?.total ?? 0 })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
