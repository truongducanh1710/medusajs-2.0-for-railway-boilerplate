import { MedusaContainer } from "@medusajs/framework"
import {
  Frequency,
  vnDate,
  periodKeyFor,
  periodDeadline,
  shouldSpawnToday,
  isOlderPeriod,
  spawnInstanceForPeriod,
} from "../modules/mkt-task/recurring-helpers"

// Chạy 00:00 giờ VN (17:00 UTC) mỗi ngày — đầu ngày VN.
// A. Auto-miss: instance kỳ trước chưa done → "missed".
// B. Spawn: sinh instance kỳ hiện tại cho mỗi template active (daily mỗi ngày, weekly Thứ 2, monthly ngày 1).
export default async function mktTaskRecurring(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const svc = container.resolve("mktTaskModule") as any

  const vn = vnDate()
  logger?.info?.(`[MktTaskRecurring] Tick VN=${vn.toISOString()}`)

  let missedCount = 0
  let spawnedCount = 0

  // ── A. Auto-miss instance quá kỳ ──────────────────────────────────────────
  try {
    const openInstances = await svc.listMktTasks(
      { is_template: false, status: ["todo", "in_progress"], deleted_at: null },
      { select: ["id", "template_id", "period_key", "frequency", "status"], take: 5000 },
    )
    let missed = 0
    for (const inst of openInstances) {
      if (!inst.template_id) continue // chỉ áp dụng cho instance của template lặp
      // period_key của kỳ "hiện tại" tuỳ frequency template — nhưng instance lưu period_key cùng dạng
      // với template gốc. So sánh theo từng dạng key bằng chuỗi (cùng dạng nên sortable).
      const currentDailyKey = periodKeyFor("daily", vn)
      const currentWeeklyKey = periodKeyFor("weekly", vn)
      const currentMonthlyKey = periodKeyFor("monthly", vn)
      // Xác định kỳ hiện tại tương ứng dạng key của instance
      const pk: string = inst.period_key || ""
      let currentKey = currentDailyKey
      if (/^\d{4}-W\d{2}$/.test(pk)) currentKey = currentWeeklyKey
      else if (/^\d{4}-\d{2}$/.test(pk)) currentKey = currentMonthlyKey

      if (isOlderPeriod(pk, currentKey)) {
        await svc.updateMktTasks({ id: inst.id, status: "missed" })
        missed++
      }
    }
    missedCount = missed
    logger?.info?.(`[MktTaskRecurring] Auto-missed ${missed} overdue instance(s)`)
  } catch (e: any) {
    logger?.error?.(`[MktTaskRecurring] Auto-miss error: ${e.message}`)
  }

  // ── B. Spawn instance kỳ hiện tại ─────────────────────────────────────────
  try {
    const templates = await svc.listMktTasks(
      { is_template: true, deleted_at: null },
      { take: 1000 },
    )
    let spawned = 0
    for (const tpl of templates) {
      const freq = (tpl.frequency || "once") as Frequency
      if (freq === "once") continue
      if (!shouldSpawnToday(freq, vn)) continue

      const periodKey = periodKeyFor(freq, vn)
      const deadline = periodDeadline(freq, vn)
      const created = await spawnInstanceForPeriod(svc, tpl, periodKey, deadline)
      if (created) {
        spawned++
        // Thông báo vào channel nếu có
        if (tpl.channel_id) {
          await svc.createMktMessages({
            channel_id: tpl.channel_id,
            author_id: "system",
            content: `🔁 Việc lặp kỳ mới: "${tpl.title}" → ${tpl.assignee_id}`,
            task_id: created.id,
            msg_type: "recurring_spawn",
            metadata: { task_title: tpl.title, assignee_id: tpl.assignee_id, period_key: periodKey },
          }).catch(() => {})
        }
      }
    }
    spawnedCount = spawned
    logger?.info?.(`[MktTaskRecurring] Spawned ${spawned} instance(s) for current period`)
  } catch (e: any) {
    logger?.error?.(`[MktTaskRecurring] Spawn error: ${e.message}`)
  }

  // ── C. Ghi job-run-log — kiểm tra job có tick hay không mà không cần log Railway ──
  try {
    await svc.createJobRunLogs({
      job_name: "mkt-task-recurring",
      ran_at: new Date(),
      status: "ok",
      detail: { vn: vn.toISOString(), missed: missedCount, spawned: spawnedCount },
    })
  } catch (e: any) {
    logger?.error?.(`[MktTaskRecurring] job-run-log write error: ${e.message}`)
  }
}

export const config = {
  name: "mkt-task-recurring",
  schedule: "0 17 * * *", // 17:00 UTC = 00:00 VN — đầu ngày VN
}
