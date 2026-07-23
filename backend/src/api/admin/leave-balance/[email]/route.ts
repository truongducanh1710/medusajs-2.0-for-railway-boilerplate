import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail, userHasPerm } from "../../cham-cong/_lib"

// PATCH /admin/leave-balance/:email — HR chỉnh tay accrued_days (VD cộng bù phép năm cũ,
// điều chỉnh theo hợp đồng riêng). Chỉ page.nhan-su.manage.
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await userHasPerm(req, email, "page.nhan-su.manage"))) {
      return res.status(403).json({ error: "Ban khong co quyen chinh phep nam" })
    }

    const targetEmail = decodeURIComponent(req.params.email)
    const { year, accrued_days } = req.body as any
    const y = Number(year) || new Date().getFullYear()
    if (typeof accrued_days !== "number" || accrued_days < 0) {
      return res.status(400).json({ error: "accrued_days phai la so >= 0" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const [existing] = await svc.listLeaveBalances({ user_email: targetEmail, year: y, deleted_at: null })

    const balance = existing
      ? await svc.updateLeaveBalances({ id: existing.id, accrued_days })
      : await svc.createLeaveBalances({ user_email: targetEmail, year: y, accrued_days, used_days: 0 })

    res.json({ balance })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
