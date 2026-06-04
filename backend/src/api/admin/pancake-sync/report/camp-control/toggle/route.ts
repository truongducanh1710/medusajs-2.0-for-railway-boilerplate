import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo, checkCampOwner, callFbApi, logAction } from "../_lib"

/**
 * POST /admin/pancake-sync/report/camp-control/toggle
 * Body: { campaign_id, action: 'pause' | 'activate' }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { campaign_id, action } = (req.body as any) || {}
    if (!campaign_id || !["pause", "activate"].includes(action)) {
      return res.status(400).json({ error: "Cần campaign_id và action ∈ {pause, activate}" })
    }

    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const check = await checkCampOwner(req, campaign_id, auth)
    if (!check.ok || !check.camp) return res.status(403).json({ error: check.reason })

    const newStatus = action === "pause" ? "PAUSED" : "ACTIVE"
    const fb = await callFbApi("POST", `/${campaign_id}?status=${newStatus}`)

    const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any
    if (fb.ok) {
      // Update DB ngay với giá trị local (optimistic), rồi verify nền
      await sqlSvc.sql(
        `UPDATE mkt_ads_cost SET effective_status = $1, updated_at = now()
         WHERE campaign_id = $2
           AND date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
        [newStatus, campaign_id]
      ).catch(() => {})

      // Verify nền — không await, không chặn response
      callFbApi("GET", `/${campaign_id}?fields=status`).then(verify => {
        if (verify.ok && verify.data?.status && verify.data.status !== newStatus) {
          sqlSvc.sql(
            `UPDATE mkt_ads_cost SET effective_status = $1, updated_at = now()
             WHERE campaign_id = $2 AND date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
            [verify.data.status, campaign_id]
          ).catch(() => {})
        }
      }).catch(() => {})
    }

    await logAction(req, {
      campaign_id, campaign_name: check.camp.campaign_name, action,
      old_value: { status: check.camp.effective_status },
      new_value: { status: newStatus },
      source: "manual", user_email: auth.email,
      fb_response: fb.data, success: fb.ok,
    })

    if (!fb.ok) return res.status(502).json({ error: fb.data?.error?.message || "FB API error", fb: fb.data })
    return res.json({ ok: true, status: newStatus })
  } catch (err: any) {
    console.error("[camp-control/toggle]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
