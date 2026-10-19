import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canEditAdsRules, EDIT_DENIED, logRuleChange } from "../../../../lib/ads-rules"
import { ensurePixelAudiences, listExclusions, syncBlockList } from "../../../../lib/ads-exclusion"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"

/** GET /admin/auto-scale/exclusions — tệp loại trừ đang dùng cho camp mới, theo tài khoản. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  return res.json({ audiences: await listExclusions() })
}

/**
 * POST /admin/auto-scale/exclusions — chỉ AI. body: { pixel?: true, block?: true }
 * pixel: tạo/ghi nhận tệp "đăng ký 180 ngày" theo pixel; block: thay toàn bộ danh sách tệp chặn POS ngay.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  if (!canEditAdsRules(auth.email)) return res.status(403).json({ error: EDIT_DENIED })
  const b = (req.body || {}) as any
  const out: any = {}
  if (b.pixel !== false) out.pixel = await ensurePixelAudiences()
  if (b.block !== false) out.block = await syncBlockList()
  await logRuleChange("ads_exclusion", null, null, out, auth.email, b.reason || "Đồng bộ tệp loại trừ")
  return res.json(out)
}
