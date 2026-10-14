import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo, checkCampOwner, callFbApi } from "../_lib"
import { extractMkt } from "../../../../../../lib/mkt-code"

/**
 * POST /admin/pancake-sync/report/camp-control/schedule
 * Body: { campaign_id, action: 'pause'|'activate'|'set_budget', scheduled_at: ISO, payload?: { daily_budget } }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { campaign_id, action, scheduled_at, payload } = (req.body as any) || {}
    if (!campaign_id || !["pause", "activate", "set_budget"].includes(action) || !scheduled_at) {
      return res.status(400).json({ error: "Cần campaign_id, action, scheduled_at" })
    }
    const when = new Date(scheduled_at)
    if (isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      return res.status(400).json({ error: "scheduled_at phải là ISO date trong tương lai" })
    }
    if (action === "set_budget" && (!payload?.daily_budget || Number(payload.daily_budget) < 50000)) {
      return res.status(400).json({ error: "set_budget cần payload.daily_budget >= 50000" })
    }

    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    let check = await checkCampOwner(req, campaign_id, auth)
    // Camp mới tạo chưa có chi tiêu thì chưa đồng bộ vào mkt_ads_cost (vd tạo tối nay, hẹn bật sáng mai) —
    // đọc thẳng từ FB, lấy MKT từ tên camp để kiểm quyền. Bộ chạy lịch không cần dòng mkt_ads_cost.
    if (!check.camp) {
      const fb = await callFbApi("GET", `/${campaign_id}?fields=name,effective_status,daily_budget`)
      if (!fb.ok || !fb.data?.name) {
        return res.status(404).json({ error: `Không tìm thấy camp trên FB: ${fb.data?.error?.message ?? campaign_id}` })
      }
      const mkt = extractMkt(fb.data.name)
      const allowed = auth.isSuper || (!!mkt && auth.mktCodes.includes(mkt))
      check = allowed
        ? { ok: true, camp: { campaign_name: fb.data.name, mkt_name: mkt, daily_budget: Number(fb.data.daily_budget) || null, effective_status: fb.data.effective_status } }
        : { ok: false, reason: `Camp thuộc MKT ${mkt || "không rõ"}, bạn được phép: ${auth.mktCodes.join(", ")}` }
    }
    if (!check.ok || !check.camp) return res.status(403).json({ error: check.reason })

    const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any
    const rows = await sqlSvc.sql(
      `INSERT INTO camp_schedule (campaign_id, campaign_name, action, payload, scheduled_at, created_by_email)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6)
       RETURNING id, scheduled_at, status`,
      [campaign_id, check.camp.campaign_name, action, JSON.stringify(payload ?? null), when.toISOString(), auth.email]
    )
    return res.json({ ok: true, schedule: rows[0] })
  } catch (err: any) {
    console.error("[camp-control/schedule POST]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

/**
 * GET /admin/pancake-sync/report/camp-control/schedule?campaign_id=...
 * Trả về list pending + recent done schedules của camp.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { campaign_id } = req.query as Record<string, string>
    if (!campaign_id) return res.status(400).json({ error: "Cần campaign_id" })

    const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any
    const schedules = await sqlSvc.sql(
      `SELECT id, action, payload, scheduled_at, executed_at, status, error_message, created_by_email, created_at
       FROM camp_schedule
       WHERE campaign_id = $1 AND deleted_at IS NULL
       ORDER BY scheduled_at DESC LIMIT 20`,
      [campaign_id]
    )
    return res.json({ schedules })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
