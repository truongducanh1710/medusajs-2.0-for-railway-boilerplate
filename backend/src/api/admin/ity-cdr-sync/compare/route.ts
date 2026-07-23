import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

// Cùng fix múi giờ đã áp cho ../report/route.ts và ../calls/route.ts: nếu caller gửi
// "YYYY-MM-DD" thuần, new Date(str) bị hiểu là UTC 00:00 thay vì "00:00 giờ VN" — lệch
// 7 tiếng. UI hiện tại (cskh-goi-khach/page.tsx) đã tự thêm offset nên không dính, chuẩn
// hoá tại nguồn để an toàn cho client khác gọi endpoint này sau này.
const isBareDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
function startOfDayVN(dateStr: string): Date {
  return isBareDate(dateStr) ? new Date(`${dateStr}T00:00:00+07:00`) : new Date(dateStr)
}
function endOfDayVN(dateStr: string): Date {
  return isBareDate(dateStr) ? new Date(`${dateStr}T23:59:59+07:00`) : new Date(dateStr)
}

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
    const fromDate = from ? startOfDayVN(from) : new Date(`${todayStr}T00:00:00+07:00`)
    const toDate = to ? endOfDayVN(to) : new Date(`${todayStr}T23:59:59+07:00`)

    const syncService = req.scope.resolve("ityCdrSyncModule") as any
    const taskService = req.scope.resolve("mktTaskModule") as any
    const userService = req.scope.resolve(Modules.USER) as any

    const [calls, maps, allUsers, tasks] = await Promise.all([
      syncService.listItyCdrCalls(
        { calldate: { $gte: fromDate, $lte: toDate } } as any,
        { take: 100_000, select: ["extension", "calldate", "disposition", "customer_phone"] as any }
      ),
      syncService.listItyExtensionMaps({}),
      userService.listUsers({}, { select: ["id", "email", "first_name", "last_name"] }),
      // Lấy toàn bộ task cskh_call (không lọc theo called_at) — match với CDR bằng SĐT để không phụ thuộc
      // vào field called_at/first_called_at (chỉ có với task được xử lý sau khi field này ra đời).
      taskService.listMktTasks(
        { type: "cskh_call" } as any,
        { take: 100_000, select: ["assignee_id", "call_stage", "customer_phone", "created_at"] as any }
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
    // Gom CDR theo 9 số cuối SĐT khách -> danh sách cuộc gọi (dùng để match với task theo customer_phone)
    const callsByPhone: Record<string, any[]> = {}
    for (const c of calls as any[]) {
      const email = emailByExtension[c.extension]
      if (!email) { unmappedExtensionCalls++ } else {
        const bucket = ensure(email)
        bucket.real_calls++
        if (c.disposition === "ANSWERED") bucket.real_answered++
      }
      const digits = (c.customer_phone || "").replace(/\D/g, "").slice(-9)
      if (!digits) continue
      if (!callsByPhone[digits]) callsByPhone[digits] = []
      callsByPhone[digits].push(c)
    }

    // Task "đã xử lý" trong khoảng đang xem = có ít nhất 1 cuộc gọi CDR thật khớp SĐT khách
    // trong khoảng from-to (không phụ thuộc field called_at/first_called_at — khớp cả dữ liệu cũ).
    // "Số mới": cuộc gọi thật đầu tiên khớp task này rơi đúng ngày task được giao (created_at).
    // "Số cũ": task tồn đọng, cuộc gọi thật đầu tiên khớp xảy ra sau ngày giao.
    // by_day: gộp theo [ngày gọi thật][email] để vẽ biểu đồ theo dõi hằng ngày.
    const byDay: Record<string, Record<string, { new_numbers: number; old_numbers: number }>> = {}
    for (const t of tasks as any[]) {
      if (!t.assignee_id) continue
      const digits = (t.customer_phone || "").replace(/\D/g, "").slice(-9)
      const matchedCalls = digits ? (callsByPhone[digits] || []) : []
      if (matchedCalls.length === 0) continue

      const bucket = ensure(t.assignee_id)
      bucket.task_calls++
      const firstMatch = matchedCalls.reduce((min: any, c: any) => (!min || new Date(c.calldate) < new Date(min.calldate)) ? c : min, null)
      const createdDay = t.created_at ? new Date(t.created_at).toISOString().slice(0, 10) : null
      const firstCallDay = firstMatch ? new Date(firstMatch.calldate).toISOString().slice(0, 10) : null
      const isNew = !!(firstCallDay && createdDay && firstCallDay === createdDay)
      if (isNew) bucket.new_numbers++
      else bucket.old_numbers++

      if (firstCallDay) {
        if (!byDay[firstCallDay]) byDay[firstCallDay] = {}
        if (!byDay[firstCallDay][t.assignee_id]) byDay[firstCallDay][t.assignee_id] = { new_numbers: 0, old_numbers: 0 }
        if (isNew) byDay[firstCallDay][t.assignee_id].new_numbers++
        else byDay[firstCallDay][t.assignee_id].old_numbers++
      }
    }

    const rows = Object.entries(byEmail)
      .map(([email, stats]) => ({
        email,
        name: nameByEmail[email] || email,
        ...stats,
        diff: stats.real_calls - stats.task_calls,
      }))
      .sort((a, b) => b.real_calls - a.real_calls)

    const byDayArr = Object.keys(byDay)
      .sort()
      .map(day => ({
        day,
        by_agent: Object.entries(byDay[day]).map(([email, s]) => ({
          email,
          name: nameByEmail[email] || email,
          new_numbers: s.new_numbers,
          old_numbers: s.old_numbers,
          total: s.new_numbers + s.old_numbers,
        })),
      }))

    return res.json({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      rows,
      by_day: byDayArr,
      unmapped_extension_calls: unmappedExtensionCalls,
    })
  } catch (err: any) {
    console.error("[ItyCdrSync Compare API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
