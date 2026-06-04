import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo, callFbApi } from "../_lib"

/**
 * GET /admin/pancake-sync/report/camp-control/verify?campaign_id=xxx
 * Lấy status thật từ FB — UI gọi sau ~1.5s để check có lệch không.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const campaign_id = (req.query as any).campaign_id
    if (!campaign_id) return res.status(400).json({ error: "Thiếu campaign_id" })

    const verify = await callFbApi("GET", `/${campaign_id}?fields=status,effective_status,daily_budget`)
    if (!verify.ok) return res.status(502).json({ error: "FB API error", fb: verify.data })

    return res.json({
      campaign_id,
      status: verify.data.status ?? null,
      effective_status: verify.data.effective_status ?? null,
      daily_budget: verify.data.daily_budget ? Math.round(Number(verify.data.daily_budget)) : null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
