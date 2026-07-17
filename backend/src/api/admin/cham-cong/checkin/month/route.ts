import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail } from "../../_lib"

// GET /admin/cham-cong/checkin/month?month=2026-07 — logs + đơn nghỉ đã duyệt của CHÍNH user trong tháng
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const month = String((req.query as any).month || "")
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month phai dang YYYY-MM" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const monthStart = `${month}-01`
    const [y, m] = month.split("-").map(Number)
    const nextMonthStart = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)

    const [logs, leaves, configRows, defaultConfig] = await Promise.all([
      svc.listChamCongLogs(
        { user_email: email, day_key: { $gte: monthStart, $lt: nextMonthStart }, deleted_at: null },
        { order: { created_at: "ASC" } }
      ),
      svc.listLeaveRequests(
        { requester_email: email, status: "approved", deleted_at: null },
        {}
      ),
      svc.listChamCongConfigs({ id: "default" }),
      null,
    ])

    const config = configRows[0] || { shift_start: "08:30", shift_end: "17:30", work_days: [1, 2, 3, 4, 5, 6], late_grace_min: 5 }

    // Chỉ trả leave chồng lấn với tháng đang xem (approved có thể trải nhiều tháng).
    const monthEndExclusive = new Date(`${nextMonthStart}T00:00:00Z`)
    const monthStartDate = new Date(`${monthStart}T00:00:00Z`)
    const leavesInMonth = leaves.filter((l: any) => {
      const s = new Date(l.start_at)
      const e = new Date(l.end_at)
      return e > monthStartDate && s < monthEndExclusive
    })

    res.json({ logs, leaves: leavesInMonth, config })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
