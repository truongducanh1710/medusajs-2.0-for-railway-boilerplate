import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail } from "../../cham-cong/_lib"
import { monthKeyOfWeek } from "../_lib"
import { QA_CRITERIA, computeTotal } from "../../../../modules/mkt-task/qa-criteria"

// GET /admin/qa/weekly-scores?dept=van_don&week_key=2026-W29
// Điểm tuần của mọi nhân sự trong tuần được chọn (để render grid chấm).
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as any
    const svc = req.scope.resolve("mktTaskModule") as any
    const filter: any = { deleted_at: null }
    if (q.dept) filter.dept = String(q.dept)
    if (q.week_key) filter.week_key = String(q.week_key)
    if (q.month_key) filter.month_key = String(q.month_key)
    if (q.employee_email) filter.employee_email = String(q.employee_email)
    const scores = await svc.listQaWeeklyScores(filter, { order: { week_key: "DESC" }, take: 5000 })
    res.json({ scores })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/qa/weekly-scores — chấm/sửa điểm tuần cho 1 nhân sự (upsert theo employee+week).
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Không xác định được người dùng" })
    const b = req.body as any
    if (!b.employee_email || !b.dept || !b.week_key) {
      return res.status(400).json({ error: "Thiếu employee_email / dept / week_key" })
    }
    const criteria = QA_CRITERIA[b.dept]
    if (!criteria) return res.status(400).json({ error: `dept không hợp lệ: ${b.dept}` })

    // Kẹp điểm trong [0, max] từng tiêu chí — chống nhập vượt trần.
    const clamped: any = {}
    for (const c of criteria) {
      const v = Number(b[c.key] ?? 0)
      clamped[c.key] = Math.max(0, Math.min(c.max, isNaN(v) ? 0 : Math.round(v)))
    }
    const fatal_flag = !!b.fatal_flag
    const total = computeTotal({ ...clamped, fatal_flag } as any)
    const month_key = monthKeyOfWeek(String(b.week_key))

    const svc = req.scope.resolve("mktTaskModule") as any
    const existing = await svc.listQaWeeklyScores(
      { employee_email: String(b.employee_email), week_key: String(b.week_key), deleted_at: null }, { take: 1 }
    )
    const payload = {
      employee_email: String(b.employee_email),
      dept: String(b.dept),
      week_key: String(b.week_key),
      month_key,
      ...clamped,
      fatal_flag,
      total,
      comment: b.comment || null,
      scored_by: email,
    }
    let score
    if (existing.length) {
      score = await svc.updateQaWeeklyScores({ id: existing[0].id, ...payload })
    } else {
      ;[score] = await svc.createQaWeeklyScores([payload])
    }
    res.json({ score })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
