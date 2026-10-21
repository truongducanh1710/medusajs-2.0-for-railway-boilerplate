/**
 * Builds and keeps today's CSKH call list during the shift (08:30–17:00 VN), every 15 min, so
 * the list exists at 08:30 even before anyone opens /app/cskh and done/reopened states keep up
 * with notes and carrier updates (synced by pancake-transit-sync).
 */

import { MedusaContainer } from "@medusajs/framework"
import { computeCskhTasks, syncDailyList, vnMinuteOfDay, CSKH_START_MIN, CSKH_END_MIN } from "../lib/cskh-queue"

export default async function cskhDailyList(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const now = Date.now()
  const m = vnMinuteOfDay(now)
  if (m < CSKH_START_MIN || m > CSKH_END_MIN + 15) return
  try {
    const { tasks } = await computeCskhTasks(now)
    await syncDailyList(tasks, now)
  } catch (err: any) {
    logger?.error?.(`[CskhDailyList] ${err.message}`)
  }
}

export const config = {
  name: "cskh-daily-list",
  // 01:30–10:15 UTC = 08:30–17:15 VN (minute 0/15/30/45 of hours 1–10; gated above)
  schedule: "*/15 1-10 * * *",
}
