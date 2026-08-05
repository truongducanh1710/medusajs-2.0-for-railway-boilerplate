import { MedusaContainer } from "@medusajs/framework"
import { PANCAKE_SHOPS } from "../lib/constants"

const FINAL_STATUSES = [3, 5, 6, 7]
const NIGHTLY_DAYS_BACK = 7

// Trần thời gian 1 lần chạy. Job này từng chiếm slot worker duy nhất hơn 40 phút
// (concurrency "forbid" chặn chồng lặp nhưng KHÔNG có timeout), khiến 155 job khác
// — gồm mkt-cost-intraday-sync — xếp hàng vô thời hạn và không cron nào chạy nữa.
const RUN_DEADLINE_MS = 10 * 60_000

export default async function pancakeIncrementalSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("pancakeSyncModule") as any

  const deadline = Date.now() + RUN_DEADLINE_MS
  const label = "nightly final"

  // Chỉ còn nhánh nightly đối soát final statuses. Nhánh "active" (status 0,1,2,4,9,11
  // chạy ban ngày mỗi 5 phút) đã bỏ: đo trên production 14 ngày, webhook ghi 97.8%
  // thay đổi status và số đơn CHỈ cron bắt được = 0 — nó chỉ quét lại thứ webhook
  // đã cập nhật. status=0 vẫn được pancake-active-orders-sync phủ mỗi 2 phút.
  for (const shop of PANCAKE_SHOPS) {
    if (!shop.shopId || !shop.apiKey) {
      logger?.warn?.(`[PancakeJob] Skip market=${shop.market} — chưa cấu hình shopId/apiKey`)
      continue
    }

    if (Date.now() > deadline) {
      logger?.warn?.(`[PancakeJob] Quá ${RUN_DEADLINE_MS / 60000} phút — dừng, bỏ qua các shop còn lại`)
      break
    }

    const shopLabel = `${shop.market}${shop.platform ? `/${shop.platform}` : ""}`
    const startedAt = new Date()
    logger?.info?.(`[PancakeJob][${shopLabel}] Running ${label} sync for statuses ${FINAL_STATUSES.join(",")}`)

    const statusResults: Array<{ status: number; total: number; updated: number; created: number; errors: number }> = []

    for (const status of FINAL_STATUSES) {
      if (Date.now() > deadline) {
        logger?.warn?.(`[PancakeJob][${shopLabel}] Hết thời gian — bỏ qua status còn lại`)
        break
      }
      try {
        const result = await syncService.pullByStatus(
          status,
          { market: shop.market, shopId: shop.shopId, apiKey: shop.apiKey, daysBack: NIGHTLY_DAYS_BACK }
        )
        statusResults.push({ status, ...result })
        logger?.info?.(
          `[PancakeJob][${shopLabel}] status=${status} → total=${result.total} updated=${result.updated} created=${result.created} errors=${result.errors}`
        )
      } catch (err: any) {
        logger?.error?.(`[PancakeJob][${shopLabel}] status=${status} failed: ${err.message}`)
        statusResults.push({ status, total: 0, updated: 0, created: 0, errors: 1 })
      }
    }

    const finishedAt = new Date()
    await syncService.logCronRun({
      run_type: label,
      started_at: startedAt,
      finished_at: finishedAt,
      statuses: statusResults,
      market: shop.market,
    })
  }
}

export const config = {
  name: "pancake-incremental-sync",
  // 1 lần/ngày thay vì */5. Trước đây job này quét lại ~33.000 đơn mỗi 5 phút
  // (Pancake API không lọc được theo ngày — daysBack lọc client-side SAU khi đã tải về),
  // mỗi đơn 2 query DB tuần tự → một lần chạy mất >30 phút và chặn cả queue.
  // 03:20 UTC = 10:20 VN — sau giờ cao điểm sáng, trước ca chiều.
  schedule: "20 3 * * *",
}
