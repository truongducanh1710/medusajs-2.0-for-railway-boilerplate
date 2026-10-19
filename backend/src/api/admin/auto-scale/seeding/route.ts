import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canEditAdsRules, EDIT_DENIED, logRuleChange } from "../../../../lib/ads-rules"
import { getTemplate, replaceTemplate, seedingLogs, seedPost } from "../../../../lib/ads-seeding"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"

/** GET /admin/auto-scale/seeding?product=PHVVN026CV — mẫu seeding của SP + 50 lần seed gần nhất. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  const product = String((req.query as any).product || "")
  return res.json({ template: product ? await getTemplate(product) : [], logs: await seedingLogs() })
}

/**
 * POST /admin/auto-scale/seeding — chỉ AI.
 *  { action: "template", product_code, items: [{ sort, message, image_url? }], reason } → thay mẫu của SP
 *  { action: "apply", post_id, product_code, link, force? } → page bình luận theo mẫu lên post
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  if (!canEditAdsRules(auth.email)) return res.status(403).json({ error: EDIT_DENIED })
  const b = (req.body || {}) as any
  if (b.action === "template") {
    if (!b.product_code || !Array.isArray(b.items) || !b.items.length || !b.reason) return res.status(400).json({ error: "Cần product_code, items, reason" })
    const r = await replaceTemplate(String(b.product_code), b.items, auth.email)
    await logRuleChange("ads_seeding_template", b.product_code, r.before, r.after, auth.email, b.reason)
    return res.json({ template: r.after })
  }
  if (b.action === "apply") {
    if (!b.post_id || !b.product_code || !b.link) return res.status(400).json({ error: "Cần post_id, product_code, link" })
    return res.json(await seedPost({ post_id: String(b.post_id), product_code: String(b.product_code), link: String(b.link), by: auth.email, force: b.force === true }))
  }
  return res.status(400).json({ error: "action phải là template hoặc apply" })
}
