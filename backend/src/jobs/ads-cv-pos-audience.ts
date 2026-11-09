import { syncCvPosAudience } from "../lib/ads-exclusion"
import { logRuleChange } from "../lib/ads-rules"

/** Mỗi 15 phút: đẩy SĐT khách có đơn POS lên tệp theo SP — chảo vàng (cv_pos, user 6/11/2026), kệ gia vị (kgv_pos, user 9/11/2026). */
export default async function adsCvPosAudienceJob() {
  try {
    const r = await syncCvPosAudience()
    const errors = r.filter((x) => x.error || x.rename_error || x.ok === false)
    if (errors.length) console.error("[AdsCvPos] errors:", JSON.stringify(errors))
    // Only the first load goes to rule history; every 15 min would drown it
    if (r.some((x) => x.created)) {
      const kinds = [...new Set(r.filter((x) => x.created).map((x) => x.kind))]
      const why = kinds.includes("kgv_pos")
        ? "Tạo tệp khách có đơn kệ gia vị trên POS (kgv_pos, ADS342/329/327), cập nhật 15 phút/lần, Bộ tự động gắn vào loại trừ camp kệ. User 9/11: \"phần loại trừ bổ sung đơn pos kệ\""
        : "Tạo tệp khách đăng ký chảo vàng trên POS, cập nhật 15 phút/lần. User 6/11: \"tạo tệp khách đăng ký chảo vàng trên pos và cập nhật theo 15p / lần\""
      await logRuleChange("ads_exclusion", null, null, r.filter((x) => x.created), "job:ads-cv-pos-audience", why)
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
