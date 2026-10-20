import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canEditAdsRules, EDIT_DENIED, logRuleChange } from "../../../../lib/ads-rules"
import { approveSet, listSets, saveSet, seedingLogs, seedPost } from "../../../../lib/ads-seeding"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"

/** GET /admin/auto-scale/seeding — các bộ mẫu seeding (theo SP + landing, trạng thái nháp/đã duyệt) + 50 lần seed gần nhất. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  return res.json({ sets: await listSets(), logs: await seedingLogs(), can_edit: canEditAdsRules(auth.email), can_approve: auth.isSuper })
}

/**
 * POST /admin/auto-scale/seeding
 *  { action: "template", product_code, ten, landing_match?, set_key?, items: [{ sort, message, image_url? }], reason } — chỉ AI; luôn về NHÁP
 *  { action: "approve", set_key } — super admin duyệt bộ mẫu (từ đó camp SP đó seed theo bộ này)
 *  { action: "apply", post_id, product_code, link } — chỉ AI; chỉ seed khi có bộ ĐÃ DUYỆT khớp SP + landing
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  const b = (req.body || {}) as any
  if (b.action === "approve") {
    if (!auth.isSuper) return res.status(403).json({ error: "Chỉ super admin được duyệt mẫu seeding" })
    const set = await approveSet(String(b.set_key || ""), auth.email)
    if (!set) return res.status(404).json({ error: "Không tìm thấy bộ mẫu" })
    await logRuleChange("ads_seeding_set", set.set_key, null, { set_key: set.set_key, status: "approved" }, auth.email, b.reason || "Duyệt mẫu seeding")
    return res.json({ set })
  }
  if (!canEditAdsRules(auth.email)) return res.status(403).json({ error: EDIT_DENIED })
  if (b.action === "template") {
    if (!b.product_code || !b.ten || !Array.isArray(b.items) || !b.items.length || !b.reason) return res.status(400).json({ error: "Cần product_code, ten, items, reason" })
    const r = await saveSet({ set_key: b.set_key, product_code: String(b.product_code), ten: String(b.ten), landing_match: b.landing_match || null, items: b.items }, auth.email)
    await logRuleChange("ads_seeding_set", r.key, r.before, r.after, auth.email, b.reason)
    return res.json({ set: r.after })
  }
  if (b.action === "apply") {
    if (!b.post_id || !b.product_code || !b.link) return res.status(400).json({ error: "Cần post_id, product_code, link" })
    return res.json(await seedPost({ post_id: String(b.post_id), product_code: String(b.product_code), link: String(b.link), by: auth.email, force: b.force === true }))
  }
  return res.status(400).json({ error: "action phải là template, approve hoặc apply" })
}
