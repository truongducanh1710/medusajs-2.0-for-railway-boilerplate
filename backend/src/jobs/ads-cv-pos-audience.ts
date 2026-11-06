import { syncCvPosAudience } from "../lib/ads-exclusion"
import { logRuleChange } from "../lib/ads-rules"

/** Mỗi 15 phút: đẩy SĐT khách đăng ký chảo vàng trên POS lên tệp PHV_CV_CHẢO VÀNG_DANGKY_POS_AUTO (user 6/11/2026). */
export default async function adsCvPosAudienceJob() {
  try {
    const r = await syncCvPosAudience()
    const errors = r.filter((x) => x.error || x.rename_error || x.ok === false)
    if (errors.length) console.error("[AdsCvPos] errors:", JSON.stringify(errors))
    // Only the first load goes to rule history; every 15 min would drown it
    if (r.some((x) => x.created)) {
      await logRuleChange("ads_exclusion", null, null, r, "job:ads-cv-pos-audience", "Tạo tệp khách đăng ký chảo vàng trên POS, cập nhật 15 phút/lần. User 6/11: \"tạo tệp khách đăng ký chảo vàng trên pos và cập nhật theo 15p / lần\"")
    }
    if (r.length) console.log("[AdsCvPos]", JSON.stringify(r))
  } catch (e: any) {
    console.error("[AdsCvPos] error:", e.message)
  }
}

export const config = {
  name: "ads-cv-pos-audience",
  schedule: "*/15 * * * *",
}
