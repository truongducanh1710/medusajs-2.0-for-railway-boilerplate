import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail } from "../../../_lib"
import { userHasOvertimeApprovePerm } from "../../route"

// PATCH /admin/cham-cong/overtime/:id/decision — duyệt/từ chối OT, cho sửa số phút khi duyệt
// (VD nhân viên quên bấm checkout đúng giờ, manager biết giờ thực tế qua xác nhận khác).
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await userHasOvertimeApprovePerm(req, email))) {
      return res.status(403).json({ error: "Ban khong co quyen duyet OT" })
    }

    const { id } = req.params
    const { decision, approved_duration_min, note } = req.body as any
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: "decision phai la 'approved' hoac 'rejected'" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const [request] = await svc.listOvertimeRequests({ id, deleted_at: null })
    if (!request) return res.status(404).json({ error: "Khong tim thay ban ghi OT" })
    if (request.status !== "pending") {
      return res.status(400).json({ error: "Ban ghi da duoc xu ly truoc do" })
    }

    const update: any = {
      id,
      status: decision,
      reviewer_email: email,
      reviewed_at: new Date(),
    }
    if (decision === "approved") {
      update.approved_duration_min =
        typeof approved_duration_min === "number" && approved_duration_min > 0
          ? Math.round(approved_duration_min)
          : request.duration_min
    }
    if (note) update.note = String(note).slice(0, 500)

    const updated = await svc.updateOvertimeRequests(update)
    res.json({ request: updated })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
