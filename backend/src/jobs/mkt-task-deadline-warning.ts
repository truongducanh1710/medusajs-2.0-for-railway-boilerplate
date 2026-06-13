import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"

// Chạy mỗi 30 phút — cảnh báo task deadline còn ~2h mà chưa done/cancelled/pending_review
// Gửi email cho assignee + tất cả manager
export default async function mktTaskDeadlineWarning(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const svc = container.resolve("mktTaskModule") as any

  const now = new Date()
  const in2h = new Date(now.getTime() + 2 * 3600 * 1000)
  const in2h30 = new Date(now.getTime() + 2.5 * 3600 * 1000) // window 30 phút

  logger?.info?.(`[MktDeadlineWarning] Checking tasks deadline between ${in2h.toISOString()} and ${in2h30.toISOString()}`)

  try {
    const tasks = await svc.listMktTasks({})
    const warningTasks = tasks.filter((t: any) => {
      if (!t.deadline) return false
      if (["done", "cancelled", "pending_review"].includes(t.status)) return false
      const dl = new Date(t.deadline).getTime()
      return dl >= in2h.getTime() && dl < in2h30.getTime()
    })

    if (warningTasks.length === 0) {
      logger?.info?.("[MktDeadlineWarning] No tasks in warning window")
      return
    }

    const userModule = container.resolve(Modules.USER) as any
    const notifModule = container.resolve(Modules.NOTIFICATION) as any
    const BACKEND_URL = process.env.BACKEND_URL || "https://api.phanviet.vn"
    const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL

    // Lấy tất cả manager email
    const allUsers = await userModule.listUsers({}, { select: ["email", "metadata"] })
    const managerEmails: string[] = allUsers
      .filter((u: any) => {
        if (u.email === SUPER_ADMIN_EMAIL) return true
        const perms: string[] = Array.isArray(u.metadata?.permissions) ? u.metadata.permissions : []
        return perms.includes("page.mkt-tasks.manage")
      })
      .map((u: any) => u.email)
      .filter(Boolean)

    for (const task of warningTasks) {
      const taskUrl = `${BACKEND_URL}/app/mkt-tasks?task=${task.id}`
      const deadlineStr = new Date(task.deadline).toLocaleString("vi-VN", {
        hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric",
        timeZone: "Asia/Ho_Chi_Minh",
      })

      // Tìm tên assignee
      const assigneeUser = allUsers.find((u: any) => u.email === task.assignee_id)
      const assigneeName = assigneeUser
        ? ([assigneeUser.first_name, assigneeUser.last_name].filter(Boolean).join(" ") || assigneeUser.email)
        : task.assignee_id

      const recipients = [...new Set([task.assignee_id, ...managerEmails])].filter(Boolean)

      for (const email of recipients) {
        try {
          await notifModule.createNotifications({
            to: email,
            channel: "email",
            template: "task-reminder",
            data: {
              taskTitle: task.title,
              assigneeName,
              deadline: deadlineStr,
              taskUrl,
              type: "deadline_2h",
            },
          })
        } catch (e: any) {
          logger?.warn?.(`[MktDeadlineWarning] Failed to send email to ${email}: ${e.message}`)
        }
      }

      // Post message vào channel nếu có
      if (task.channel_id) {
        await svc.createMktMessages({
          channel_id: task.channel_id,
          author_id: "system",
          content: `⏰ Còn ~2 giờ: "${task.title}" (deadline ${deadlineStr})`,
          task_id: task.id,
          msg_type: "deadline_warning_2h",
          reactions: {},
          mentions: [],
        }).catch(() => {})
      }

      logger?.info?.(`[MktDeadlineWarning] Warned task ${task.id} "${task.title}" to ${recipients.length} recipients`)
    }

    logger?.info?.(`[MktDeadlineWarning] Done — warned ${warningTasks.length} tasks`)
  } catch (e: any) {
    logger?.error?.(`[MktDeadlineWarning] Error: ${e.message}`)
  }
}

export const config = {
  name: "mkt-task-deadline-warning",
  schedule: "*/30 * * * *", // Mỗi 30 phút
}
