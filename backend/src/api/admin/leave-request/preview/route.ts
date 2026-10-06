import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail } from "../../cham-cong/_lib"
import { leaveWorkDays } from "../../../../admin/lib/leave-days"
import { computeLeaveQuota } from "../../leave-balance/route"

// GET /admin/leave-request/preview?start_at=&end_at= — form tạo đơn gọi khi đổi ngày/giờ:
// số ngày của đơn (tính như server) + phép năm còn lại của quý chứa ngày nghỉ, để báo vượt
// phép ngay trên form thay vì đợi bấm Gửi mới bị từ chối.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    const start = new Date(String((req.query as any).start_at || ""))
    const end = new Date(String((req.query as any).end_at || ""))
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return res.status(400).json({ error: "Khoang thoi gian khong hop le" })
    }
    const svc = req.scope.resolve("mktTaskModule") as any
    const { config, ...quota } = await computeLeaveQuota(svc, email, start)
    const days = leaveWorkDays(start, end, config || {})
    const available = Math.round((quota.remaining_days - quota.pending_days) * 100) / 100
    res.json({ days, available, quota })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
