import { MedusaContainer } from "@medusajs/framework"

const FB_API_BASE = "https://graph.facebook.com/v18.0"

async function callFb(method: "POST", path: string): Promise<{ ok: boolean; data: any }> {
  const token = process.env.FB_ACCESS_TOKEN || ""
  const sep = path.includes("?") ? "&" : "?"
  try {
    const res = await fetch(`${FB_API_BASE}${path}${sep}access_token=${token}`, { method })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok && !data?.error, data }
  } catch (err: any) {
    return { ok: false, data: { error: { message: err.message } } }
  }
}

export default async function campScheduleExecutor(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const sqlSvc = container.resolve("cskhAnalysisModule") as any

  const due: any[] = await sqlSvc.sql(`
    SELECT id, campaign_id, campaign_name, action, payload, created_by_email
    FROM camp_schedule
    WHERE status = 'pending' AND deleted_at IS NULL AND scheduled_at <= now()
    ORDER BY scheduled_at ASC LIMIT 50
  `).catch(() => [])

  if (!due.length) return

  logger?.info?.(`[CampSchedule] Processing ${due.length} due schedules`)

  for (const s of due) {
    // Lấy current state để log old_value
    const campRows: any[] = await sqlSvc.sql(
      `SELECT effective_status, daily_budget FROM mkt_ads_cost WHERE campaign_id = $1 ORDER BY date DESC LIMIT 1`,
      [s.campaign_id]
    ).catch(() => [])
    const current = campRows[0] || {}

    let fbPath = ""
    let newValue: any = {}
    if (s.action === "pause") { fbPath = `/${s.campaign_id}?status=PAUSED`; newValue = { status: "PAUSED" } }
    else if (s.action === "activate") { fbPath = `/${s.campaign_id}?status=ACTIVE`; newValue = { status: "ACTIVE" } }
    else if (s.action === "set_budget") {
      const budget = Number(s.payload?.daily_budget)
      if (!budget || budget < 50000) {
        await sqlSvc.sql(`UPDATE camp_schedule SET status = 'failed', error_message = $1, executed_at = now() WHERE id = $2`,
          ["Invalid daily_budget in payload", s.id])
        continue
      }
      fbPath = `/${s.campaign_id}?daily_budget=${Math.round(budget)}`
      newValue = { daily_budget: Math.round(budget) }
    }

    const fb = await callFb("POST", fbPath)

    if (fb.ok) {
      // Update local
      const todayVNDate = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`
      if (s.action === "set_budget") {
        await sqlSvc.sql(`UPDATE mkt_ads_cost SET daily_budget = $1, updated_at = now() WHERE campaign_id = $2 AND date = ${todayVNDate}`,
          [newValue.daily_budget, s.campaign_id]).catch(() => {})
      } else {
        await sqlSvc.sql(`UPDATE mkt_ads_cost SET effective_status = $1, updated_at = now() WHERE campaign_id = $2 AND date = ${todayVNDate}`,
          [newValue.status, s.campaign_id]).catch(() => {})
      }
      await sqlSvc.sql(`UPDATE camp_schedule SET status = 'done', executed_at = now() WHERE id = $1`, [s.id])
      logger?.info?.(`[CampSchedule] ✓ ${s.action} ${s.campaign_name}`)
    } else {
      await sqlSvc.sql(`UPDATE camp_schedule SET status = 'failed', error_message = $1, executed_at = now() WHERE id = $2`,
        [fb.data?.error?.message || "FB API error", s.id])
      logger?.error?.(`[CampSchedule] ✗ ${s.action} ${s.campaign_name}: ${fb.data?.error?.message}`)
    }

    await sqlSvc.sql(
      `INSERT INTO camp_action_log (campaign_id, campaign_name, action, old_value, new_value, source, schedule_id, user_email, fb_response, success)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'schedule', $6, $7, $8::jsonb, $9)`,
      [s.campaign_id, s.campaign_name, s.action,
       JSON.stringify(current), JSON.stringify(newValue),
       s.id, s.created_by_email, JSON.stringify(fb.data), fb.ok]
    ).catch(() => {})
  }
}

export const config = {
  name: "camp-schedule-executor",
  schedule: "* * * * *",
}
