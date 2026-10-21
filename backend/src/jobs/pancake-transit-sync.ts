/**
 * Full refresh of orders after the sale confirmed them — chờ kho (1), chờ VTP lấy (9),
 * đang giao (2), đang hoàn (4) — every 30 minutes during working hours.
 *
 * Why: the regular syncs only update `status` of these orders, never tags / carrier info /
 * notes. The CSKH queue depends on exactly those ("Giao không thành" tag, bưu tá, số lần
 * giao); on 21/10/2026 they were 27–93h stale on average.
 *
 * Also re-pulls, a few per run, DB rows still in those statuses that POS no longer lists in
 * the window (orders from 2025 still "đang giao" in DB) so they heal or drop out.
 */

import { MedusaContainer } from "@medusajs/framework"
import { getPool } from "../lib/db"

const STATUSES = [1, 9, 2, 4]
const DAYS_BACK = 45
const HEAL_PER_RUN = 40

export default async function pancakeTransitSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("pancakeSyncModule") as any

  const vnHour = new Date(Date.now() + 7 * 3600_000).getUTCHours()
  if (vnHour < 7 || vnHour >= 22) return

  const startedAt = Date.now()
  const parts: string[] = []
  for (const status of STATUSES) {
    try {
      const r = await syncService.pullByStatus(status, { market: "VN", daysBack: DAYS_BACK })
      parts.push(`s${status}=${r.updated}u/${r.created}c/${r.errors}e`)
    } catch (err: any) {
      parts.push(`s${status}=fail`)
      logger?.error?.(`[TransitSync] status=${status} failed: ${err.message}`)
    }
  }

  // Rows the passes above did not touch (older than the window, or no longer in these
  // statuses on POS) — refresh the oldest-synced ones one by one.
  let healed = 0
  try {
    const { rows } = await getPool().query(
      `SELECT id FROM pancake_order
        WHERE deleted_at IS NULL AND market = 'VN' AND status IN (1, 9, 2, 4)
          AND synced_at < $1
        ORDER BY synced_at ASC
        LIMIT ${HEAL_PER_RUN}`,
      [new Date(startedAt)]
    )
    for (const r of rows) {
      try {
        if (await syncService.refreshOrderFromPos(String(r.id))) healed++
      } catch {}
    }
  } catch (err: any) {
    logger?.warn?.(`[TransitSync] heal failed: ${err.message}`)
  }

  logger?.info?.(`[TransitSync] ${parts.join(" ")} healed=${healed} in ${Math.round((Date.now() - startedAt) / 1000)}s`)
}

export const config = {
  name: "pancake-transit-sync",
  schedule: "*/30 * * * *",
}
