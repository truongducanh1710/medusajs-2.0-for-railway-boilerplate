import { MedusaContainer } from "@medusajs/framework"
import { reapStalePresenceSessions } from "../api/admin/mkt-chat/_presence"

/**
 * Đóng các presence session mồ côi (server restart / mất mạng đột ngột → req.on("close")
 * không chạy). Không có job này thì session treo ended_at = NULL và luôn hiện "đang online"
 * dù người ta đã về từ lâu. Report cũng tự reap khi mở, đây là lưới an toàn định kỳ.
 */
export default async function presenceSessionReaperJob(_container: MedusaContainer) {
  try {
    const closed = await reapStalePresenceSessions()
    if (closed > 0) console.log(`[presence-reaper] closed ${closed} stale session(s)`)
  } catch (e: any) {
    console.error("[presence-reaper] job failed:", e.message)
  }
}

export const config = {
  name: "presence-session-reaper",
  schedule: "*/5 * * * *",
}
