import { syncBlockList } from "../lib/ads-exclusion"
import { logRuleChange } from "../lib/ads-rules"

/**
 * Mùng 1 hằng tháng, 3h sáng giờ VN: thay toàn bộ danh sách tệp "chặn POS" (khách bị chặn + hoàn hàng 180 ngày)
 * trên các tài khoản ads. Job chạy mỗi giờ, chỉ làm việc đúng mùng 1 lúc 3h VN (không phụ thuộc múi giờ máy chủ).
 */
export default async function adsExclusionSyncJob() {
  const vn = new Date(Date.now() + 7 * 3600e3)
  if (vn.getUTCDate() !== 1 || vn.getUTCHours() !== 3) return
  try {
    const r = await syncBlockList()
    console.log(`[AdsExclusion] block list phones=${r.phones}`, JSON.stringify(r.accounts))
    await logRuleChange("ads_exclusion", null, null, r, "job:ads-exclusion-sync", "Cập nhật hằng tháng tệp chặn POS")
  } catch (e: any) {
    console.error("[AdsExclusion] error:", e.message)
  }
}

export const config = {
  name: "ads-exclusion-sync",
  schedule: "10 * * * *",
}
