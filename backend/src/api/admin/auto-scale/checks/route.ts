import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { canEditAdsRules, EDIT_DENIED } from "../../../../lib/ads-rules"
import { listChecks, runLaunchChecks } from "../../../../lib/ads-launch-check"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"

/**
 * GET /admin/auto-scale/checks?days=7 — quy trình bắt buộc của camp mới XUANLT/ANHTD: trạng thái từng bước
 * (loai_tru, cai_dat, seeding, tu_scale, theo_doi) = ok | pending | error | skip. Máy chủ tự kiểm 15 phút/lần.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  const days = Math.min(30, Math.max(1, Number((req.query as any).days) || 7))
  let rows = await listChecks(days)
  if (!auth.isSuper) rows = rows.filter((r: any) => auth.mktCodes.includes(r.mkt_name))
  return res.json({ checks: rows })
}

/** POST /admin/auto-scale/checks { campaign_id? } — chỉ AI: chạy kiểm ngay (không đợi 15 phút). */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  if (!canEditAdsRules(auth.email)) return res.status(403).json({ error: EDIT_DENIED })
  const id = String((req.body as any)?.campaign_id || "").trim()
  return res.json({ results: await runLaunchChecks(req.scope.resolve(Modules.USER), id ? { onlyCampaignId: id } : {}) })
}
