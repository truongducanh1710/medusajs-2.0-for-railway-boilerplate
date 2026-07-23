import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail } from "../../../cham-cong/_lib"
import { userHasApprovePerm } from "../../route"

// Trừ used_days vào leave_balance của năm chứa start_at khi đơn "phep_nam" được duyệt.
// Best-effort — nếu chưa có bản ghi balance (chưa qua thử việc/chưa từng accrual), tạo mới
// với accrued_days=0 để used_days không mất, HR có thể điều chỉnh sau qua PATCH /leave-balance.
async function deductLeaveBalance(svc: any, requesterEmail: string, startAt: string | Date, endAt: string | Date) {
  const days = (new Date(endAt).getTime() - new Date(startAt).getTime()) / (8 * 3600_000)
  const year = new Date(startAt).getFullYear()
  const [existing] = await svc.listLeaveBalances({ user_email: requesterEmail, year, deleted_at: null })
  if (existing) {
    await svc.updateLeaveBalances({ id: existing.id, used_days: Number(existing.used_days) + days })
  } else {
    await svc.createLeaveBalances({ user_email: requesterEmail, year, accrued_days: 0, used_days: days })
  }
}

// PATCH /admin/leave-request/:id/decision — duyệt/từ chối đơn xin nghỉ của người khác
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await userHasApprovePerm(req, email))) {
      return res.status(403).json({ error: "Ban khong co quyen duyet don" })
    }

    const { id } = req.params
    const { decision, note } = req.body as any
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: "decision phai la 'approved' hoac 'rejected'" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const [request] = await svc.listLeaveRequests({ id, deleted_at: null })
    if (!request) return res.status(404).json({ error: "Khong tim thay don" })
    if (request.status !== "pending") {
      return res.status(400).json({ error: "Don da duoc xu ly truoc do" })
    }

    const updated = await svc.updateLeaveRequests({
      id,
      status: decision,
      reviewer_email: email,
      reviewed_at: new Date(),
      review_note: note ? String(note).slice(0, 500) : null,
    })

    if (decision === "approved" && request.leave_type === "phep_nam") {
      await deductLeaveBalance(svc, request.requester_email, request.start_at, request.end_at)
    }

    res.json({ request: updated })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
