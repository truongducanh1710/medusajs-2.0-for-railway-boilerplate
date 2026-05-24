import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo } from "../../camp-control/_lib"
import { callFbApi } from "../../camp-control/_lib"

/**
 * PATCH /admin/pancake-sync/report/camp-ai/:id
 * Body: { decision: "approved" | "rejected" }
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const { decision } = (req.body as any) || {}
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "decision phải là approved hoặc rejected" })
    }

    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const sql = req.scope.resolve("cskhAnalysisModule") as any
    const rows = await sql.sql(
      `SELECT * FROM agent_camp_recommendation WHERE id = $1`, [id]
    ).catch(() => [])

    if (!rows.length) return res.status(404).json({ error: "Recommendation không tồn tại" })
    const rec = rows[0]

    if (!["pending"].includes(rec.status)) {
      return res.status(400).json({ error: `Không thể ${decision} recommendation đã ở trạng thái ${rec.status}` })
    }

    // Permission check: super admin hoặc MKT code match
    if (!auth.isSuper && auth.mktCode !== rec.mkt_name) {
      return res.status(403).json({ error: `Camp thuộc MKT ${rec.mkt_name}, bạn là ${auth.mktCode}` })
    }

    if (decision === "rejected") {
      await sql.sql(
        `UPDATE agent_camp_recommendation SET status='rejected', approved_by=$1, approved_at=now() WHERE id=$2`,
        [auth.email, id]
      )
      // Update reward signal
      await updateRolloutReward(rec.run_id, sql)
      return res.json({ ok: true, status: "rejected" })
    }

    // Approved → execute action
    let fbResp: any = null
    let fbPath = ""
    if (rec.action === "pause") fbPath = `/${rec.campaign_id}?status=PAUSED`
    else if (rec.action === "set_budget") {
      const budget = rec.suggested_value?.daily_budget
      if (!budget || budget < 50000) return res.status(400).json({ error: "Budget không hợp lệ trong suggestion" })
      fbPath = `/${rec.campaign_id}?daily_budget=${Math.round(budget)}`
    }

    if (fbPath) {
      fbResp = await callFbApi("POST", fbPath)
      if (!fbResp.ok) {
        return res.status(502).json({ error: "FB API thất bại: " + (fbResp.data?.error?.message ?? "unknown") })
      }

      // Log vào camp_action_log
      await sql.sql(
        `INSERT INTO camp_action_log (campaign_id, campaign_name, action, old_value, new_value, source, user_email, fb_response, success)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'agent',$6,$7::jsonb,$8)`,
        [rec.campaign_id, rec.campaign_name, rec.action,
         JSON.stringify(rec.old_value ?? {}), JSON.stringify(rec.suggested_value ?? {}),
         auth.email, JSON.stringify(fbResp.data), true]
      ).catch(() => {})
    }

    await sql.sql(
      `UPDATE agent_camp_recommendation SET status='approved', approved_by=$1, approved_at=now(), executed_at=now(), fb_response=$2::jsonb WHERE id=$3`,
      [auth.email, JSON.stringify(fbResp?.data ?? null), id]
    )

    await updateRolloutReward(rec.run_id, sql)
    return res.json({ ok: true, status: "approved", fb_ok: fbResp?.ok })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

async function updateRolloutReward(runId: string, sql: any) {
  await sql.sql(`
    UPDATE agent_art_rollout SET
      reward = (
        SELECT ROUND(
          COUNT(*) FILTER (WHERE status = 'approved')::numeric /
          NULLIF(COUNT(*) FILTER (WHERE status IN ('approved','rejected')), 0),
        2)
        FROM agent_camp_recommendation WHERE run_id = $1
      ),
      outcomes = (
        SELECT jsonb_build_object(
          'total', COUNT(*),
          'approved', COUNT(*) FILTER (WHERE status='approved'),
          'rejected', COUNT(*) FILTER (WHERE status='rejected'),
          'pending', COUNT(*) FILTER (WHERE status='pending'),
          'auto_executed', COUNT(*) FILTER (WHERE status='auto_executed'),
          'no_action', COUNT(*) FILTER (WHERE action='no_action')
        )
        FROM agent_camp_recommendation WHERE run_id = $1
      )
    WHERE run_id = $1
  `, [runId]).catch(() => {})
}
