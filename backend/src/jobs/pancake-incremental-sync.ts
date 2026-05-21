import { MedusaContainer } from "@medusajs/framework"

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

  logger?.info?.(`[PancakeJob] Running ${label} sync for statuses ${statuses.join(",")}`)

  for (const status of statuses) {
    try {
      const result = await syncService.pullByStatus(
        status,
        isNightly ? { daysBack: NIGHTLY_DAYS_BACK } : undefined
      )
      logger?.info?.(
        `[PancakeJob] status=${status} → total=${result.total} updated=${result.updated} created=${result.created} errors=${result.errors}`
      )
    } catch (err: any) {
      logger?.error?.(`[PancakeJob] status=${status} failed: ${err.message}`)
    }
  }
}

export const config = {
  name: "pancake-incremental-sync",
  schedule: "*/5 * * * *",
}
