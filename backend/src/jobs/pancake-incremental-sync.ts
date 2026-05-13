/**
 * Pancake incremental sync — scheduled job.
 *
 * - Every 30 minutes: pulls orders from the last 2 hours (catch small gaps).
 * - Nightly at 02:00 VN time: pulls last 7 days (catch-up for any missed webhooks).
 *
 * Uses Medusa v2 scheduled job conventions.
 * Register this job in medusa-config.js if needed, or it may be auto-discovered
 * from the `src/jobs/` directory.
 */

import { MedusaContainer } from "@medusajs/framework"

const TWO_HOURS = 2 * 60 * 60 * 1000
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

export default async function pancakeIncrementalSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("pancakeSyncModule") as any

  const now = new Date()

  // Nightly deep catch-up (runs at ~02:00)
  const currentHour = now.getHours()
  const isNightlyRun = currentHour >= 1 && currentHour <= 3

  if (isNightlyRun) {
    logger?.info?.("[PancakeJob] Running nightly 7-day catch-up sync")
    const from = new Date(now.getTime() - SEVEN_DAYS)
    try {
      const { jobId } = await syncService.pullByDateRange(from, now)
      logger?.info?.(`[PancakeJob] Nightly sync queued: jobId=${jobId}`)
    } catch (err: any) {
      logger?.error?.(`[PancakeJob] Nightly sync failed: ${err.message}`)
    }
  } else {
    // Regular 30-minute incremental
    logger?.info?.("[PancakeJob] Running 2-hour incremental sync")
    const from = new Date(now.getTime() - TWO_HOURS)
    try {
      const { jobId } = await syncService.pullByDateRange(from, now)
      logger?.info?.(`[PancakeJob] Incremental sync queued: jobId=${jobId}`)
    } catch (err: any) {
      // SYNC_IN_PROGRESS is expected — don't log as error
      if (err.message?.includes("SYNC_IN_PROGRESS")) {
        logger?.info?.("[PancakeJob] Skipped — another sync already in progress")
      } else {
        logger?.error?.(`[PancakeJob] Incremental sync failed: ${err.message}`)
      }
    }
  }
}

export const config = {
  name: "pancake-incremental-sync",
  /**
   * Cron expression: every 30 minutes.
   * Format: minute hour day month weekday
   */
  schedule: "*/30 * * * *",
}
