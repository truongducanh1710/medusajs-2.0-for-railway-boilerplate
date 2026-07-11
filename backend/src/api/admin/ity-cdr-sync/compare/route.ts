import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * GET /admin/ity-cdr-sync/compare?from=...&to=...
 * Đối chiếu số cuộc gọi thật (CDR tổng đài ITY) với số task CSKH đã cập nhật call_stage
 * trong cùng khoảng thời gian, theo từng nhân viên (join qua email).
 * Mặc định: hôm nay (theo giờ VN).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.query as Record<string, string | undefined>

    const nowVN = new Date(Date.now() + 7 * 3600 * 1000)
    const todayStr = nowVN.toISOString().slice(0, 10)
    const fromDate = from ? new Date(from) : new Date(`${todayStr}T00:00:00+07:00`)
    const toDate = to ? new Date(to) : new Date(`${todayStr}T23:59:59+07:00`)

    const syncService = req.scope.resolve("ityCdrSyncModule") as any
    const taskService = req.scope.resolve("mktTaskModule") as any
    const userService = req.scope.resolve(Modules.USER) as any

    const [calls, maps, allUsers, tasks] = await Promise.all([
      syncService.listItyCdrCalls(
        { calldate: { $gte: fromDate, $lte: toDate } } as any,
        { take: 100_000, select: ["extension", "calldate", "disposition"] as any }
      ),
      syncService.listItyExtensionMaps({}),
      userService.listUsers({}, { select: ["id", "email", "first_name", "last_name"] }),
      taskService.listMktTasks(
        { type: "cskh_call", called_at: { $gte: fromDate, $lte: toDate } } as any,
        { take: 100_000, select: ["assignee_id", "call_stage", "called_at", "first_called_at", "created_at"] as any }
      ),
    ])

    const usersById: Record<string, any> = Object.fromEntries(allUsers.map((u: any) => [u.id, u]))
    // extension -> email (qua ity_extension_map.user_id -> user.email)
    const emailByExtension: Record<string, string> = {}
    const nameByEmail: Record<string, string> = {}
    for (const m of maps as any[]) {
      const u = m.user_id ? usersById[m.user_id] : null
      if (u?.email) {
        emailByExtension[m.extension] = u.email
        nameByEmail[u.email] = (u.first_name || u.last_name) ? [u.first_name, u.last_name].filter(Boolean).join(" ") : u.email
      }
    }
    for (const u of allUsers as any[]) {
      if (!nameByEmail[u.email]) {
        nameByEmail[u.email] = (u.first_name || u.last_name) ? [u.first_name, u.last_name].filter(Boolean).join(" ") : u.email
      }
    }

    const byEmail: Record<string, { real_calls: number; real_answered: number; task_calls: number; new_numbers: number; old_numbers: number }> = {}
    const ensure = (email: string) => {
      if (!byEmail[email]) byEmail[email] = { real_calls: 0, real_answered: 0, task_calls: 0, new_numbers: 0, old_numbers: 0 }
      return byEmail[email]
    }

    let unmappedExtensionCalls = 0
    for (const c of calls as any[]) {
      const email = emailByExtension[c.extension]
      if (!email) { unmappedExtensionCalls++; continue }
      const bucket = ensure(email)
      bucket.real_calls++
      if (c.disposition === "ANSWERED") bucket.real_answered++
    }

    // "Số mới": task được xử lý (đổi call_stage) lần đầu tiên đúng vào ngày được giao (created_at).
    // "Số cũ": task tồn đọng qua ngày khác mới được xử lý — kể cả lần xử lý đầu tiên đó xảy ra hôm nay.
    for (const t of tasks as any[]) {
      if (!t.assignee_id || !t.call_stage || t.call_stage === "chua_goi") continue
      const bucket = ensure(t.assignee_id)
      bucket.task_calls++
      const createdDay = t.created_at ? new Date(t.created_at).toISOString().slice(0, 10) : null
      const firstCalledDay = t.first_called_at ? new Date(t.first_called_at).toISOString().slice(0, 10) : null
      if (firstCalledDay && createdDay && firstCalledDay === createdDay) bucket.new_numbers++
      else bucket.old_numbers++
    }

    const rows = Object.entries(byEmail)
      .map(([email, stats]) => ({
        email,
        name: nameByEmail[email] || email,
        ...stats,
        diff: stats.real_calls - stats.task_calls,
      }))
      .sort((a, b) => b.real_calls - a.real_calls)

    return res.json({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      rows,
      unmapped_extension_calls: unmappedExtensionCalls,
    })
  } catch (err: any) {
    console.error("[ItyCdrSync Compare API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
