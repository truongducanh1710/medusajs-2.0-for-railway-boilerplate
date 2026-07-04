import { MedusaContainer } from "@medusajs/framework"
import { PANCAKE_SHOPS } from "../lib/constants"

const ACTIVE_STATUSES = [0, 1, 2, 4, 9, 11]
const FINAL_STATUSES = [3, 5, 6, 7]
const NIGHTLY_DAYS_BACK = 7

export default async function pancakeIncrementalSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("pancakeSyncModule") as any

  const hour = new Date().getHours()
  const isNightly = hour >= 1 && hour <= 3
  const statuses = isNightly ? FINAL_STATUSES : ACTIVE_STATUSES
  const label = isNightly ? "nightly final" : "active"

  // Loop tuần tự qua từng shop (không song song — tránh rủi ro rate-limit Pancake API)
  for (const shop of PANCAKE_SHOPS) {
    if (!shop.shopId || !shop.apiKey) {
      logger?.warn?.(`[PancakeJob] Skip market=${shop.market} — chưa cấu hình shopId/apiKey`)
      continue
    }

    const shopLabel = `${shop.market}${shop.platform ? `/${shop.platform}` : ""}`
    const startedAt = new Date()
    logger?.info?.(`[PancakeJob][${shopLabel}] Running ${label} sync for statuses ${statuses.join(",")}`)

    const statusResults: Array<{ status: number; total: number; updated: number; created: number; errors: number }> = []

    for (const status of statuses) {
      try {
        const result = await syncService.pullByStatus(
          status,
          { market: shop.market, shopId: shop.shopId, apiKey: shop.apiKey, ...(isNightly ? { daysBack: NIGHTLY_DAYS_BACK } : {}) }
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
  schedule: "*/5 * * * *",
}
