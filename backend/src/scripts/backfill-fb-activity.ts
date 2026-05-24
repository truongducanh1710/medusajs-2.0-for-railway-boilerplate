/**
 * Backfill FB camp activities cho 90 ngày gần nhất.
 * Chạy 1 lần: medusa exec ./src/scripts/backfill-fb-activity.ts
 */
import { syncFbActivities } from "../jobs/fb-activity-sync"

export default async function backfillFbActivity({ container }: { container: any }) {
  const DAYS = 90
  const today = new Date()

  console.log(`[backfill-fb-activity] Bắt đầu pull ${DAYS} ngày gần nhất...`)

  for (let i = 1; i <= DAYS; i++) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const dateStr = d.toISOString().slice(0, 10)

    process.stdout.write(`[${i}/${DAYS}] ${dateStr} ... `)
    try {
      await syncFbActivities(container, dateStr)
      console.log("done")
    } catch (err: any) {
      console.log("ERROR:", err.message)
    }

    // Nghỉ 500ms giữa các ngày để tránh rate limit FB
    await new Promise(r => setTimeout(r, 500))
  }

  console.log("[backfill-fb-activity] Hoàn thành.")
}
