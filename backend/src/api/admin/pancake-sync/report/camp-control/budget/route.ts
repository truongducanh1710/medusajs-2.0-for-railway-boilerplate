import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo, checkCampOwner, callFbApi, logAction } from "../_lib"

const MIN_BUDGET = 50000  // VND
const MAX_BUDGET = 50000000

/**
 * PATCH /admin/pancake-sync/report/camp-control/budget
 * Body: { campaign_id, daily_budget: 500000 }
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { campaign_id, daily_budget } = (req.body as any) || {}
    const budget = Number(daily_budget)
    if (!campaign_id || !Number.isFinite(budget) || budget < MIN_BUDGET || budget > MAX_BUDGET) {
      return res.status(400).json({ error: `Cần campaign_id + daily_budget ∈ [${MIN_BUDGET}, ${MAX_BUDGET}] VND` })
    }

    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const check = await checkCampOwner(req, campaign_id, auth)
    if (!check.ok || !check.camp) return res.status(403).json({ error: check.reason })

    const fb = await callFbApi("POST", `/${campaign_id}?daily_budget=${Math.round(budget)}`)

    const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any
    if (fb.ok) {
      await sqlSvc.sql(
        `UPDATE mkt_ads_cost SET daily_budget = $1, updated_at = now() WHERE campaign_id = $2 AND date = CURRENT_DATE`,
        [Math.round(budget), campaign_id]
      ).catch(() => {})
    }

    await logAction(req, {
      campaign_id, campaign_name: check.camp.campaign_name, action: "set_budget",
      old_value: { daily_budget: check.camp.daily_budget },
      new_value: { daily_budget: Math.round(budget) },
      source: "manual", user_email: auth.email,
      fb_response: fb.data, success: fb.ok,
    })

    if (!fb.ok) return res.status(502).json({ error: fb.data?.error?.message || "FB API error", fb: fb.data })
    return res.json({ ok: true, daily_budget: Math.round(budget) })
  } catch (err: any) {
    console.error("[camp-control/budget]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
