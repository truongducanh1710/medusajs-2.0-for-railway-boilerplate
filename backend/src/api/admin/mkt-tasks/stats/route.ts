import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

function normalizeEmail(value: any): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

async function isManager(req: MedusaRequest): Promise<boolean> {
  const uid = actorId(req)
  if (!uid) return false
  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email", "metadata"] })
  if (user.email === superEmail) return true
  const perms: string[] = Array.isArray((user.metadata as any)?.permissions)
    ? (user.metadata as any).permissions : []
  return perms.includes("page.mkt-tasks.manage")
}

// GET /admin/mkt-tasks/stats - báo cáo hiệu suất per-member (manager only)
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (!(await isManager(req))) return res.status(403).json({ error: "Không có quyền" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const userModule = req.scope.resolve(Modules.USER)

    const { type } = req.query as any
    const filter: Record<string, any> = { deleted_at: null }
    if (type) filter.type = type
    const allTasks = await svc.listMktTasks(filter)

    // Resolve names — map theo cả user id lẫn email (assignee_id lưu là email)
    const allUsers = await userModule.listUsers({}, { select: ["id", "email", "first_name", "last_name"] })
    const userMap: Record<string, string> = {}
    for (const u of allUsers) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
      userMap[u.id] = name
      if (u.email) userMap[u.email] = name
    }

    // Templates: dùng cho khối "Tổng hợp việc lặp", KHÔNG tính vào per-member
    const templates = allTasks.filter((t: any) => t.is_template)
    // Instance + one-off: dùng cho per-member aggregation. Task tự giao không tính KPI manager.
    const realTasks = allTasks.filter((t: any) =>
      !t.is_template && normalizeEmail(t.created_by) !== normalizeEmail(t.assignee_id)
    )

    // Per-member aggregation
    const memberMap: Record<string, {
      assignee_id: string
      total: number
      done: number
      in_progress: number
      cancelled: number
      todo: number
      missed: number
      done_on_time: number
      ratings: number[]
    }> = {}

    for (const t of realTasks) {
      if (!memberMap[t.assignee_id]) {
        memberMap[t.assignee_id] = {
          assignee_id: t.assignee_id,
          total: 0, done: 0, in_progress: 0, cancelled: 0, todo: 0, missed: 0,
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
      if (t.status === "missed") m.missed++
    }

    const stats = Object.values(memberMap).map(m => ({
      assignee_id: m.assignee_id,
      assignee_name: userMap[m.assignee_id] || m.assignee_id,
      total: m.total,
      done: m.done,
      in_progress: m.in_progress,
      todo: m.todo,
      cancelled: m.cancelled,
      missed: m.missed,
      done_rate: m.total > 0 ? Math.round(m.done / m.total * 100) : 0,
      // Tỉ lệ kỳ làm đúng hạn cho việc lặp: done / (done + missed)
      period_done_rate: (m.done + m.missed) > 0 ? Math.round(m.done / (m.done + m.missed) * 100) : null,
      on_time_rate: m.done > 0 ? Math.round(m.done_on_time / m.done * 100) : 0,
      avg_rating: m.ratings.length > 0
        ? Math.round(m.ratings.reduce((a, b) => a + b, 0) / m.ratings.length * 10) / 10
        : null,
    }))

    // ── Tổng hợp việc lặp: mỗi template kèm danh sách kỳ (instance) ──────────
    const instancesByTemplate: Record<string, any[]> = {}
    for (const t of realTasks) {
      if (!t.template_id) continue
      if (!instancesByTemplate[t.template_id]) instancesByTemplate[t.template_id] = []
      instancesByTemplate[t.template_id].push(t)
    }

    const recurring = templates.map((tpl: any) => {
      const periods = (instancesByTemplate[tpl.id] || [])
        .map((i: any) => ({
          id: i.id,
          period_key: i.period_key,
          status: i.status,
          result: i.result || null,
          deadline: i.deadline,
        }))
        .sort((a: any, b: any) => String(b.period_key).localeCompare(String(a.period_key)))
      const doneN = periods.filter((p: any) => p.status === "done").length
      const missedN = periods.filter((p: any) => p.status === "missed").length
      return {
        template_id: tpl.id,
        title: tpl.title,
        type: tpl.type,
        frequency: tpl.frequency,
        output: tpl.output || null,
        assignee_id: tpl.assignee_id,
        assignee_name: userMap[tpl.assignee_id] || tpl.assignee_id,
        done: doneN,
        missed: missedN,
        total_periods: periods.length,
        period_done_rate: (doneN + missedN) > 0 ? Math.round(doneN / (doneN + missedN) * 100) : null,
        periods,
      }
    })

    res.json({ stats, recurring })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
