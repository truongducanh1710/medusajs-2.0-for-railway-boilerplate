import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncFbActivities } from "../../../../../jobs/fb-activity-sync"

/**
 * GET /admin/pancake-sync/report/fb-activity
 * Query: from, to, mkt, campaign_id, actor_type, event_type, limit=100, offset=0
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from, to, mkt, campaign_id, actor_type, event_type,
      limit = "100", offset = "0",
    } = req.query as Record<string, string>

    const lim = Math.min(Math.max(parseInt(limit) || 100, 1), 500)
    const off = Math.max(parseInt(offset) || 0, 0)
    const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any

    const conditions: string[] = []
    const params: any[] = []

    if (from) { params.push(from); conditions.push(`event_time >= $${params.length}::date`) }
    if (to) { params.push(to); conditions.push(`event_time < ($${params.length}::date + interval '1 day')`) }
    if (mkt) { params.push(mkt); conditions.push(`mkt_name = $${params.length}`) }
    if (campaign_id) { params.push(campaign_id); conditions.push(`campaign_id = $${params.length}`) }
    if (actor_type) { params.push(actor_type); conditions.push(`actor_type = $${params.length}`) }
    if (event_type) { params.push(event_type); conditions.push(`event_type = $${params.length}`) }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : ""
    params.push(lim, off)

    const [activities, countRows] = await Promise.all([
      sqlSvc.sql(
        `SELECT id, ad_account_id, campaign_id, campaign_name, mkt_name,
                actor_name, actor_type, event_type, event_time,
                old_value, new_value, synced_at
         FROM fb_camp_activity ${where}
         ORDER BY event_time DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ).catch(() => []),
      sqlSvc.sql(
        `SELECT COUNT(*)::int as total FROM fb_camp_activity ${where}`,
        params.slice(0, -2)
      ).catch(() => [{ total: 0 }]),
    ])

    return res.json({ activities, total: countRows[0]?.total ?? 0 })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/pancake-sync/report/fb-activity
 * Body: { date?: "2026-05-24" } — manual trigger
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { date } = (req.body as any) ?? {}
  const targetDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - 1)
        return d.toISOString().slice(0, 10)
      })()

  res.json({ ok: true, date: targetDate, message: `Đang sync FB activities cho ${targetDate}...` })

  ;(async () => {
    try {
      await syncFbActivities(req.scope as any, targetDate)
    } catch (err: any) {
      console.error("[fb-activity POST] error:", err.message)
    }
  })()
}
