import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

// GET /admin/mkt-tasks/stats - báo cáo hiệu suất per-member (manager only)
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = req.scope.resolve("mktTaskModule") as any
    const userModule = req.scope.resolve(Modules.USER)

    const allTasks = await svc.listMktTasks({ deleted_at: null })

    // Per-member aggregation
    const memberMap: Record<string, {
      assignee_id: string
      total: number
      done: number
      in_progress: number
      cancelled: number
      todo: number
      done_on_time: number
      ratings: number[]
    }> = {}

    for (const t of allTasks) {
      if (!memberMap[t.assignee_id]) {
        memberMap[t.assignee_id] = {
          assignee_id: t.assignee_id,
          total: 0, done: 0, in_progress: 0, cancelled: 0, todo: 0,
          done_on_time: 0, ratings: [],
        }
      }
      const m = memberMap[t.assignee_id]
      m.total++
      if (t.status === "done") {
        m.done++
        if (t.deadline && new Date(t.updated_at) <= new Date(t.deadline)) m.done_on_time++
        if (t.rating) m.ratings.push(t.rating)
      }
      if (t.status === "in_progress") m.in_progress++
      if (t.status === "cancelled") m.cancelled++
      if (t.status === "todo") m.todo++
    }

    // Resolve names
    const allUsers = await userModule.listUsers({}, { select: ["id", "email", "first_name", "last_name"] })
    const userMap: Record<string, string> = {}
    for (const u of allUsers) {
      userMap[u.id] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
    }

    const stats = Object.values(memberMap).map(m => ({
      assignee_id: m.assignee_id,
      assignee_name: userMap[m.assignee_id] || m.assignee_id,
      total: m.total,
      done: m.done,
      in_progress: m.in_progress,
      todo: m.todo,
      cancelled: m.cancelled,
      done_rate: m.total > 0 ? Math.round(m.done / m.total * 100) : 0,
      on_time_rate: m.done > 0 ? Math.round(m.done_on_time / m.done * 100) : 0,
      avg_rating: m.ratings.length > 0
        ? Math.round(m.ratings.reduce((a, b) => a + b, 0) / m.ratings.length * 10) / 10
        : null,
    }))

    res.json({ stats })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
