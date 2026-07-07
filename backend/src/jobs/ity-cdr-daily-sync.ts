import { MedusaContainer } from "@medusajs/framework"

// ITY chỉ giữ log CDR 30 ngày — sync mỗi đêm để không mất dữ liệu.
// Pull 2 ngày gần nhất (hôm qua + hôm nay) để bù trường hợp cron trước đó fail/miss.
const DAYS_BACK = 2

export default async function ityCdrDailySync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("ityCdrSyncModule") as any

  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - DAYS_BACK)

  try {
    const { jobId } = await syncService.pullByDateRange(from, to)
    logger?.info?.(`[ItyCdrJob] Started sync job ${jobId} for ${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}`)
  } catch (err: any) {
    if (err.code === "SYNC_IN_PROGRESS") {
      logger?.info?.(`[ItyCdrJob] Skip — job ${err.existingJobId} already running`)
      return
    }
    logger?.error?.(`[ItyCdrJob] Failed to start sync: ${err.message}`)
  }
}

export const config = {
  name: "ity-cdr-daily-sync",
  schedule: "0 2 * * *",
}
