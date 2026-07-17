import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail, userHasPerm } from "../../cham-cong/_lib"
import { sanitizeInput } from "../route"

// PATCH /admin/nhan-su/:id — sửa hồ sơ, chỉ ai có page.nhan-su.manage
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await userHasPerm(req, email, "page.nhan-su.manage"))) {
      return res.status(403).json({ error: "Ban khong co quyen sua nhan su" })
    }

    const { id } = req.params
    const svc = req.scope.resolve("mktTaskModule") as any
    const [existing] = await svc.listEmployeeProfiles({ id, deleted_at: null })
    if (!existing) return res.status(404).json({ error: "Khong tim thay nhan su" })

    const employee = await svc.updateEmployeeProfiles({ id, ...sanitizeInput(req.body) })
    res.json({ employee })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
