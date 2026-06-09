import { MedusaContainer } from "@medusajs/framework"

// Chạy 8:00 sáng giờ VN (01:00 UTC) mỗi ngày
// Nhắc deadline task sắp đến hôm nay vào channel liên kết
export default async function mktTaskReminder(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const svc = container.resolve("mktTaskModule") as any

  const now = new Date()
  const vnNow = new Date(now.getTime() + 7 * 3600 * 1000)
  const todayVN = vnNow.toISOString().slice(0, 10)
  const tomorrowVN = new Date(vnNow.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10)

  logger?.info?.(`[MktTaskReminder] Checking deadlines for ${todayVN}`)

  try {
    // Get tasks with deadline today and not done/cancelled
    const tasks = await svc.listMktTasks({ deleted_at: null })
    const todayTasks = tasks.filter((t: any) => {
      if (!t.deadline) return false
      if (t.status === "done" || t.status === "cancelled") return false
      const deadlineDate = new Date(t.deadline).toISOString().slice(0, 10)
      return deadlineDate === todayVN
    })

    logger?.info?.(`[MktTaskReminder] Found ${todayTasks.length} tasks due today`)

    for (const task of todayTasks) {
      if (!task.channel_id) continue

      try {
        await svc.createMktMessages({
          channel_id: task.channel_id,
          author_id: "system",
          content: `⏰ Deadline hôm nay: "${task.title}" → ${task.assignee_id}`,
          task_id: task.id,
          msg_type: "deadline_reminder",
          metadata: { task_title: task.title, assignee_id: task.assignee_id, deadline: task.deadline },
        })
      } catch (e: any) {
        logger?.warn?.(`[MktTaskReminder] Failed to post reminder for task ${task.id}: ${e.message}`)
      }
    }

    logger?.info?.(`[MktTaskReminder] Done — ${todayTasks.filter((t: any) => t.channel_id).length} reminders sent`)
  } catch (e: any) {
    logger?.error?.(`[MktTaskReminder] Error: ${e.message}`)
  }
}

export const config = {
  name: "mkt-task-reminder",
  schedule: "0 1 * * *", // 01:00 UTC = 08:00 VN
}
