import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { canEditAdsRules, EDIT_DENIED } from "../../../../lib/ads-rules"
import { planVideoLifecycle, runVideoLifecycle } from "../../../../lib/video-lifecycle"
import { emailsForMkt } from "../../../../lib/auto-scale"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"

/** GET /admin/auto-scale/video-lifecycle — xem kế hoạch: giai đoạn từng video, số camp, ad sẽ bị tắt (không đổi gì). */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  const p = await planVideoLifecycle()
  return res.json({
    today: p.today,
    videos: p.videos.map((x) => ({ key: x.key, stage: x.c?.stage ?? null, is_new: x.c?.isNew ?? null, note: x.c?.note ?? null, kill: x.c?.kill ?? null, stuck: x.c?.stuck ?? false, camps: x.camps, cap: x.cap })),
    actions: p.actions.map((a) => ({ key: a.key, stage: a.stage, kind: a.kind, campaign_id: a.ad.camp_id, campaign_name: a.ad.camp_name, ad_id: a.ad.ad_id, last_ad_in_camp: a.ad.live_in_camp <= 1, reason: a.reason })),
  })
}

/** POST /admin/auto-scale/video-lifecycle { dry?: boolean, report?: boolean, notify?: boolean } — chỉ AI: chạy ngay. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  if (!canEditAdsRules(auth.email)) return res.status(403).json({ error: EDIT_DENIED })
  const b = (req.body || {}) as any
  const userModule = req.scope.resolve(Modules.USER)
  const emails = b.notify ? [...new Set([...(await emailsForMkt(userModule, "ANHTD")), ...(await emailsForMkt(userModule, "XUANLT"))])] : []
  return res.json(await runVideoLifecycle({ userModule, emails, dry: b.dry !== false, report: !!b.report }))
}
