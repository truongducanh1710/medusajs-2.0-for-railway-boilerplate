import { syncBlockList } from "../lib/ads-exclusion"
import { logRuleChange } from "../lib/ads-rules"

/**
 * 3h sáng thứ Hai giờ VN (user 27/10/2026: mỗi ngày chỉ đổi ~10–20 SĐT → hằng tuần là đủ; 21/10 hằng ngày, trước đó mùng 1 hằng tháng): thay toàn bộ danh sách tệp "chặn POS" mới
 * (khách bị chặn + hoàn hàng 180 ngày) trên các tài khoản ads, và BỔ SUNG cùng danh sách vào tệp chặn cũ 19/6.
 * Đổi người trong tệp không làm camp học lại. Job chạy mỗi giờ, chỉ làm việc lúc 3h VN thứ Hai.
 */
export default async function adsExclusionSyncJob() {
  const vn = new Date(Date.now() + 7 * 3600e3)
  if (vn.getUTCHours() !== 3 || vn.getUTCDay() !== 1) return
  try {
    const r = await syncBlockList()
    console.log(`[AdsExclusion] block list phones=${r.phones}`, JSON.stringify(r.accounts))
    await logRuleChange("ads_exclusion", null, null, r, "job:ads-exclusion-sync", "Cập nhật hằng tuần tệp chặn POS (+ bổ sung tệp cũ 19/6)")
  } catch (e: any) {
    console.error("[AdsExclusion] error:", e.message)
  }
}

export const config = {
  name: "ads-exclusion-sync",
  schedule: "10 * * * *",
}
