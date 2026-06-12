import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

export const FB_API_BASE = "https://graph.facebook.com/v25.0"

export type AuthInfo = {
  email: string
  isSuper: boolean
  mktCode: string | null
  mktCodes: string[]
}

export async function getAuthInfo(req: MedusaRequest): Promise<AuthInfo | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
  const isSuper = !!(user.email && user.email === process.env.SUPER_ADMIN_EMAIL)
  const mktCode = ((user.metadata as any)?.mkt_code as string | undefined) ?? null
  const rawCodes = (user.metadata as any)?.mkt_codes
  const mktCodes: string[] = (Array.isArray(rawCodes) && rawCodes.length > 0) ? rawCodes : (mktCode ? [mktCode] : [])
  return { email: user.email || "", isSuper, mktCode, mktCodes }
}

/**
 * Check user có quyền thao tác camp này không.
 * Trả về { ok, camp, reason } — camp đầy đủ info để dùng tiếp.
 */
export async function checkCampOwner(req: MedusaRequest, campaignId: string, auth: AuthInfo): Promise<{
  ok: boolean
  camp?: { campaign_name: string; mkt_name: string; daily_budget: number | null; effective_status: string | null }
  reason?: string
}> {
  const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any
  const rows = await sqlSvc.sql(
    `SELECT campaign_name, mkt_name, daily_budget, effective_status FROM mkt_ads_cost WHERE campaign_id = $1 ORDER BY date DESC LIMIT 1`,
    [campaignId]
  )
  if (!rows.length) return { ok: false, reason: "Campaign không tồn tại trong DB" }
  const camp = rows[0]
  if (auth.isSuper) return { ok: true, camp }
  if (!auth.mktCodes.length) return { ok: false, reason: "User chưa được gán MKT Code", camp }
  if (!auth.mktCodes.includes(camp.mkt_name)) {
    return { ok: false, reason: `Camp thuộc MKT ${camp.mkt_name}, bạn được phép: ${auth.mktCodes.join(", ")}`, camp }
  }
  return { ok: true, camp }
}

export async function callFbApi(method: "GET" | "POST", path: string): Promise<{ ok: boolean; data: any; status: number }> {
  const token = process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
  const sep = path.includes("?") ? "&" : "?"
  const url = `${FB_API_BASE}${path}${sep}access_token=${token}`
  try {
    const res = await fetch(url, { method })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok && !data?.error, data, status: res.status }
  } catch (err: any) {
    return { ok: false, data: { error: { message: err.message } }, status: 0 }
  }
}

export async function logAction(req: MedusaRequest, opts: {
  campaign_id: string
  campaign_name: string
  action: string
  old_value: any
  new_value: any
  source: "manual" | "schedule"
  schedule_id?: string | null
  user_email: string
  fb_response: any
  success: boolean
}) {
  const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any
  await sqlSvc.sql(
    `INSERT INTO camp_action_log (campaign_id, campaign_name, action, old_value, new_value, source, schedule_id, user_email, fb_response, success)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9::jsonb, $10)`,
    [
      opts.campaign_id, opts.campaign_name, opts.action,
      JSON.stringify(opts.old_value), JSON.stringify(opts.new_value),
      opts.source, opts.schedule_id ?? null, opts.user_email,
      JSON.stringify(opts.fb_response), opts.success,
    ]
  ).catch((e: any) => console.error("[camp-control] logAction fail:", e.message))
}
