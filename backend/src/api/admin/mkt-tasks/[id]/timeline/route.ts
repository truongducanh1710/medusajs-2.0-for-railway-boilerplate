import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * GET /admin/mkt-tasks/:id/timeline
 * Ghép 2 luồng sự kiện của 1 task CSKH thành 1 timeline theo thời gian:
 * - Cuộc gọi thật qua tổng đài (CDR, match theo SĐT khách của task)
 * - Thay đổi trạng thái/ghi chú trong task (đọc từ comments[] có sẵn)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const taskService = req.scope.resolve("mktTaskModule") as any
    const syncService = req.scope.resolve("ityCdrSyncModule") as any
    const userService = req.scope.resolve(Modules.USER) as any

    const [task] = await taskService.listMktTasks({ id })
    if (!task) return res.status(404).json({ error: "Không tìm thấy task" })

    const phone = (task.customer_phone || "").replace(/\D/g, "")
    const calls = phone
      ? await syncService.listItyCdrCalls(
          { customer_phone: { $like: `%${phone.slice(-9)}` } } as any,
          { take: 500, order: { calldate: "ASC" }, select: ["extension", "calldate", "duration", "billsec", "disposition", "customer_phone"] as any }
        )
      : []

    const maps = await syncService.listItyExtensionMaps({})
    const allUsers = await userService.listUsers({}, { select: ["id", "email", "first_name", "last_name"] })
    const usersById: Record<string, any> = Object.fromEntries(allUsers.map((u: any) => [u.id, u]))
    const nameByExtension: Record<string, string> = {}
    for (const m of maps as any[]) {
      const u = m.user_id ? usersById[m.user_id] : null
      nameByExtension[m.extension] = u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email : (m.display_name || m.extension)
    }
    const nameByEmail: Record<string, string> = Object.fromEntries(
      allUsers.map((u: any) => [u.email, [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email])
    )

    const events: { type: "call" | "note"; at: string; actor: string; text: string; meta?: any }[] = []

    for (const c of calls as any[]) {
      events.push({
        type: "call",
        at: c.calldate,
        actor: nameByExtension[c.extension] || c.extension || "?",
        text: c.disposition === "ANSWERED" ? `Đã nghe máy (${c.billsec}s)` : `Không nghe máy (${c.disposition || "?"})`,
        meta: { extension: c.extension, disposition: c.disposition, billsec: c.billsec },
      })
    }

    for (const comment of (task.comments || []) as any[]) {
      events.push({
        type: "note",
        at: comment.created_at,
        actor: nameByEmail[comment.author_id] || comment.author_id,
        text: comment.text,
        meta: { system: comment.type === "system" },
      })
    }

    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

    return res.json({
      task_id: id,
      customer_phone: task.customer_phone,
      created_at: task.created_at,
      first_called_at: task.first_called_at,
      events,
    })
  } catch (err: any) {
    console.error("[MktTask Timeline API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
