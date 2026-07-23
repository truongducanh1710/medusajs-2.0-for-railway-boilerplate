import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail, userHasPerm } from "../cham-cong/_lib"

// GET /admin/leave-balance?year=2026 — số phép còn lại của chính mình; thêm ?email=
// để manager/HR xem người khác (cần page.nhan-su.manage).
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const year = Number((req.query as any).year) || new Date().getFullYear()
    const targetEmailRaw = (req.query as any).email ? String((req.query as any).email) : null

    let targetEmail = email
    if (targetEmailRaw && targetEmailRaw !== email) {
      if (!(await userHasPerm(req, email, "page.nhan-su.manage"))) {
        return res.status(403).json({ error: "Ban khong co quyen xem phep cua nguoi khac" })
      }
      targetEmail = targetEmailRaw
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const [balance] = await svc.listLeaveBalances({ user_email: targetEmail, year, deleted_at: null })
    const [config] = await svc.listChamCongConfigs({ id: "default" })
    const maxPerYear = config?.phep_nam_max_per_year ?? 12

    const accrued = balance ? Number(balance.accrued_days) : 0
    const used = balance ? Number(balance.used_days) : 0

    res.json({
      year,
      user_email: targetEmail,
      accrued_days: accrued,
      used_days: used,
      remaining_days: Number((accrued - used).toFixed(2)),
      max_per_year: maxPerYear,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
