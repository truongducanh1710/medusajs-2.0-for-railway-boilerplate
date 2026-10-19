import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canEditAdsRules, EDIT_DENIED } from "../../../../lib/ads-rules"
import { registerLaunch, videoTracking } from "../../../../lib/ads-tracking"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"

/**
 * GET /admin/auto-scale/videos?days=30&mkt=XUANLT,ANHTD — theo dõi bộ video: Hub → camp (tài khoản × page) → số liệu → giai đoạn.
 * MKT thường chỉ thấy MKT của mình.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  const q = req.query as Record<string, string>
  const days = Math.min(90, Math.max(3, Number(q.days) || 30))
  let mkts = String(q.mkt || "XUANLT,ANHTD").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  if (!auth.isSuper) mkts = mkts.filter((m) => auth.mktCodes.includes(m))
  if (!mkts.length) return res.json({ sets: [] })
  return res.json(await videoTracking({ days, mkts }))
}

/** POST /admin/auto-scale/videos — chỉ AI: ghi nhận 1 lần lên camp (kiểu lên, page, lý do, seeding, tệp loại trừ). */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  if (!canEditAdsRules(auth.email)) return res.status(403).json({ error: EDIT_DENIED })
  const b = (req.body || {}) as any
  if (!b.campaign_id || !b.mode) return res.status(400).json({ error: "Cần campaign_id, mode" })
  await registerLaunch(b, auth.email)
  return res.json({ ok: true })
}
