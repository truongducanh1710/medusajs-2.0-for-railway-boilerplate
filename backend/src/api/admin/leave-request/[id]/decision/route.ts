import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail } from "../../../cham-cong/_lib"
import { userHasApprovePerm } from "../../route"

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

    res.json({ request: updated })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
