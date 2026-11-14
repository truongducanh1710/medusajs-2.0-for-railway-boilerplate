import { MedusaContainer } from "@medusajs/framework"
import { syncVideoPerformance, dateVN } from "../lib/video-performance"

/**
 * Job: tự sync "Hiệu quả" video (mkt_ads_video: hook rate 3s, thruplay theo ad/ngày) cho
 * HÔM QUA + HÔM NAY giờ VN — trước đây chỉ có nút POST bấm tay nên bảng rỗng.
 * 23:40 VN: hôm nay gần đủ số; hôm qua đã được FB chốt lại. Tuần tự từng ngày/tài khoản.
 */
export default async function videoPerformanceDailySync(container: MedusaContainer) {
  const FB_TOKEN = process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
  if (!FB_TOKEN) {
    console.log("[VideoPerfDaily] FB_SYSTEM_TOKEN/FB_ACCESS_TOKEN chưa cấu hình — bỏ qua")
    return
  }
  const cskhService = container.resolve("cskhAnalysisModule") as any

  for (const date of [dateVN(-1), dateVN(0)]) {
    try {
      const r = await syncVideoPerformance(cskhService, FB_TOKEN, date)
      console.log(`[VideoPerfDaily] ${date} → synced=${r.synced} withVd=${r.withVd} errors=${r.errors}`)
    } catch (e: any) {
      console.error(`[VideoPerfDaily] ${date} failed:`, e?.message)
    }
  }
}

export const config = {
  name: "video-performance-daily-sync",
  // 23:40 ICT (GMT+7) = 16:40 UTC
  schedule: "40 16 * * *",
}
