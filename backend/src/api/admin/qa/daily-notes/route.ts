import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail } from "../../cham-cong/_lib"

// GET /admin/qa/daily-notes?dept=van_don&from=2026-07-13&to=2026-07-20&employee_email=...
// Trả nhật ký ngày trong khoảng, để leader xem lại trước khi chấm tuần.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as any
    const svc = req.scope.resolve("mktTaskModule") as any
    const filter: any = { deleted_at: null }
    if (q.dept) filter.dept = String(q.dept)
    if (q.employee_email) filter.employee_email = String(q.employee_email)
    if (q.from || q.to) {
      filter.note_date = {}
      if (q.from) filter.note_date.$gte = String(q.from)
      if (q.to) filter.note_date.$lte = String(q.to)
    }
    const notes = await svc.listQaDailyNotes(filter, { order: { note_date: "DESC", created_at: "DESC" }, take: 2000 })
    res.json({ notes })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/qa/daily-notes — leader thêm 1 ghi chú ngày cho 1 nhân sự.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Không xác định được người dùng" })
    const b = req.body as any
    if (!b.employee_email || !b.dept || !b.note_date || !b.content) {
      return res.status(400).json({ error: "Thiếu employee_email / dept / note_date / content" })
    }
    const svc = req.scope.resolve("mktTaskModule") as any
    const [note] = await svc.createQaDailyNotes([{
      employee_email: String(b.employee_email),
      dept: String(b.dept),
      note_date: String(b.note_date),
      label: b.label || "info",
      content: String(b.content),
      is_fatal: !!b.is_fatal,
      fatal_kind: b.fatal_kind || null,
      created_by: email,
    }])
    res.json({ note })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
