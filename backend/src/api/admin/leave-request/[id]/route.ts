import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail } from "../../cham-cong/_lib"

// PATCH /admin/leave-request/:id — người tạo tự hủy đơn của mình khi còn pending
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const { id } = req.params
    const { action } = req.body as any
    if (action !== "cancel") {
      return res.status(400).json({ error: "action khong hop le" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const [request] = await svc.listLeaveRequests({ id, deleted_at: null })
    if (!request) return res.status(404).json({ error: "Khong tim thay don" })
    if (request.requester_email !== email) {
      return res.status(403).json({ error: "Chi duoc huy don cua chinh minh" })
    }
    if (request.status !== "pending") {
      return res.status(400).json({ error: "Don da duoc xu ly, khong the huy" })
    }

    const updated = await svc.updateLeaveRequests({ id, status: "cancelled" })
    res.json({ request: updated })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
