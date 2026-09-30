import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { runAutoScale } from "../../../../lib/auto-scale"
import { getAuthInfo, checkCampOwner } from "../../pancake-sync/report/camp-control/_lib"

/**
 * POST /admin/auto-scale/run { campaign_id? } — chạy xét ngay (không đợi 15 phút).
 * Theo đúng bộ điều kiện đang gắn: rule đang chạy thử thì cũng chỉ ghi, không đổi thật.
 * Không truyền campaign_id → chạy toàn bộ (chỉ super admin).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  const campaignId = String((req.body as any)?.campaign_id || "").trim()
  if (!campaignId && !auth.isSuper) return res.status(403).json({ error: "Chỉ super admin được chạy toàn bộ" })
  if (campaignId) {
    const owner = await checkCampOwner(req, campaignId, auth)
    if (!owner.ok) return res.status(403).json({ error: owner.reason })
  }
  const r = await runAutoScale(req.scope.resolve(Modules.USER), campaignId || undefined)
  return res.json(r)
}
