import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { gradeOf } from "../../../../modules/mkt-task/qa-criteria"
import { listStaff } from "../_lib"

// GET /admin/qa/summary?dept=van_don&year=2026
// Tổng hợp điểm QA theo thời gian cho từng nhân sự:
//  - matrix tuần (mọi week_key có điểm) để vẽ xu hướng
//  - điểm trung bình từng tháng (AVERAGE các tuần trong tháng, bỏ tuần không có điểm)
//  - điểm trung bình cả kỳ + xếp loại + % thưởng
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as any
    const dept = q.dept ? String(q.dept) : null
    const year = q.year ? String(q.year) : null
    const svc = req.scope.resolve("mktTaskModule") as any

    const filter: any = { deleted_at: null }
    if (dept) filter.dept = dept
    const scores = await svc.listQaWeeklyScores(filter, { order: { week_key: "ASC" }, take: 20000 })
    const rows = year ? scores.filter((s: any) => s.week_key.startsWith(year)) : scores

    const staff = await listStaff(req)
    const nameByEmail: Record<string, string> = {}
    for (const s of staff) nameByEmail[s.email] = s.name

    // Tập tất cả tuần và tháng xuất hiện (để header cột đồng nhất giữa các nhân sự).
    const allWeeks = ([...new Set(rows.map((r: any) => r.week_key))] as string[]).sort()
    const allMonths = ([...new Set(rows.map((r: any) => r.month_key))] as string[]).sort()

    // Gom theo nhân sự.
    const byEmp: Record<string, any[]> = {}
    for (const r of rows) (byEmp[r.employee_email] ||= []).push(r)

    const people = Object.keys(byEmp).map((emailKey) => {
      const list = byEmp[emailKey]
      const weekMap: Record<string, number> = {}
      for (const r of list) weekMap[r.week_key] = r.total

      // Điểm tháng = trung bình các tuần CÓ điểm trong tháng đó (không tính tuần trống là 0).
      const monthMap: Record<string, { avg: number; weeks: number }> = {}
      for (const m of allMonths) {
        const wk = list.filter((r: any) => r.month_key === m)
        if (!wk.length) continue
        // Lỗi liệt tài chính trong tháng → điểm tháng về 0 (theo BGĐ). Ở đây total đã=0 khi fatal.
        const avg = wk.reduce((s: number, r: any) => s + r.total, 0) / wk.length
        monthMap[m] = { avg: Math.round(avg * 10) / 10, weeks: wk.length }
      }

      const monthVals = Object.values(monthMap).map((x) => x.avg)
      const overall = monthVals.length ? Math.round((monthVals.reduce((a, b) => a + b, 0) / monthVals.length) * 10) / 10 : 0
      const g = gradeOf(overall)
      return {
        employee_email: emailKey,
        name: nameByEmail[emailKey] || emailKey,
        dept: list[0]?.dept || dept || "",
        weeks: weekMap,
        months: monthMap,
        overall,
        grade: g.grade,
        bonus: g.bonus,
        tone: g.tone,
      }
    }).sort((a, b) => b.overall - a.overall)

    res.json({ all_weeks: allWeeks, all_months: allMonths, people })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
