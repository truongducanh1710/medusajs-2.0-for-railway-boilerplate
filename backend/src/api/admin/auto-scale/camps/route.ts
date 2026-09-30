import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { ensureTables, fbCampaign } from "../../../../lib/auto-scale"
import { getAuthInfo, checkCampOwner } from "../../pancake-sync/report/camp-control/_lib"

/**
 * POST /admin/auto-scale/camps — gắn camp vào bộ điều kiện (hoặc sửa mức nền / bật-tắt).
 * body: { campaign_id, rule_id, base_budget?, enabled? }
 * Mức nền mặc định = ngân sách hiện tại trên FB. Chỉ nhận camp CBO.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  await ensureTables()
  const b = (req.body || {}) as any
  const campaignId = String(b.campaign_id || "").trim()
  const ruleId = Number(b.rule_id)
  if (!campaignId || !ruleId) return res.status(400).json({ error: "Thiếu campaign_id hoặc rule_id" })

  const owner = await checkCampOwner(req, campaignId, auth)
  if (!owner.ok) return res.status(403).json({ error: owner.reason })

  const pool = getPool()
  const { rows: rr } = await pool.query(`SELECT id FROM auto_scale_rule WHERE id = $1`, [ruleId])
  if (!rr.length) return res.status(404).json({ error: "Không tìm thấy bộ điều kiện" })

  const fb = await fbCampaign(campaignId)
  if (!fb.ok) return res.status(400).json({ error: `Không đọc được camp trên FB: ${fb.data?.error?.message ?? ""}` })
  const cur = Number(fb.data.daily_budget || 0)
  if (!cur) return res.status(400).json({ error: "Camp không có ngân sách cấp campaign (ABO) — tự scale chỉ hỗ trợ camp CBO" })

  const base = b.base_budget ? Math.max(50000, Math.round(Number(b.base_budget))) : cur
  const { rows: acc } = await pool.query(
    `SELECT ad_account_id FROM mkt_ads_cost WHERE campaign_id = $1 ORDER BY date DESC LIMIT 1`, [campaignId]
  )
  const { rows } = await pool.query(
    `INSERT INTO auto_scale_camp (campaign_id, rule_id, campaign_name, ad_account_id, mkt_name, base_budget, enabled, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (campaign_id) DO UPDATE SET rule_id = EXCLUDED.rule_id, base_budget = EXCLUDED.base_budget,
       enabled = EXCLUDED.enabled, campaign_name = EXCLUDED.campaign_name, updated_at = now()
     RETURNING *`,
    [campaignId, ruleId, fb.data.name, acc[0]?.ad_account_id ?? (fb.data.account_id ? `act_${fb.data.account_id}` : null),
     owner.camp?.mkt_name ?? null, base, b.enabled !== false, auth.email]
  )
  return res.json({ camp: rows[0], current_budget: cur })
}

/** DELETE /admin/auto-scale/camps?campaign_id= — gỡ camp khỏi tự scale (không đổi ngân sách hiện tại). */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  await ensureTables()
  const campaignId = String((req.query as any).campaign_id || "")
  const owner = await checkCampOwner(req, campaignId, auth)
  if (!owner.ok) return res.status(403).json({ error: owner.reason })
  await getPool().query(`DELETE FROM auto_scale_camp WHERE campaign_id = $1`, [campaignId])
  return res.json({ ok: true })
}
