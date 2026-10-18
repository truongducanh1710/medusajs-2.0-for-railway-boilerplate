import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail, userHasPerm } from "../_lib"

export async function userHasOvertimeApprovePerm(req: MedusaRequest, email: string): Promise<boolean> {
  return userHasPerm(req, email, "page.overtime.approve")
}

// GET /admin/cham-cong/overtime?scope=mine|pending|approved&month=2026-07
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const scope = String((req.query as any).scope || "mine")
    const month = (req.query as any).month ? String((req.query as any).month) : null
    const svc = req.scope.resolve("mktTaskModule") as any

    const filter: any = { deleted_at: null }
    if (month) filter.day_key = { $gte: `${month}-01`, $lt: `${month}-32` }

    if (scope === "mine") {
      filter.user_email = email
    } else if (scope === "pending" || scope === "approved") {
      if (!(await userHasOvertimeApprovePerm(req, email))) {
        return res.status(403).json({ error: "Ban khong co quyen duyet OT" })
      }
      filter.status = scope === "pending" ? "pending" : { $in: ["approved", "rejected"] }
    } else {
      return res.status(400).json({ error: "scope khong hop le" })
    }

    const requests = await svc.listOvertimeRequests(filter, { order: { day_key: "DESC" } })
    res.json({ requests })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// Employees register their own OT; HR can still register on behalf of another employee.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const { user_email, day_key, duration_min, note } = (req.body || {}) as any
    if (user_email !== undefined && (typeof user_email !== "string" || !user_email.trim())) {
      return res.status(400).json({ error: "Email nhân viên không hợp lệ" })
    }
    const targetEmail = user_email === undefined ? email : user_email.trim()
    const isOwnRequest = targetEmail === email
    if (!isOwnRequest && !(await userHasOvertimeApprovePerm(req, email))) {
      return res.status(403).json({ error: "Bạn không có quyền đăng ký OT cho người khác" })
    }

    const validDay = typeof day_key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day_key)
      && !Number.isNaN(Date.parse(day_key)) && new Date(day_key).toISOString().slice(0, 10) === day_key
    if (!validDay || !Number.isInteger(duration_min) || duration_min <= 0 || duration_min > 1440) {
      return res.status(400).json({ error: "Chọn ngày hợp lệ và thời lượng từ 1 đến 1.440 phút" })
    }
    const reason = typeof note === "string" ? note.trim() : ""
    if ((isOwnRequest && !reason) || reason.length > 500 || (note != null && typeof note !== "string")) {
      return res.status(400).json({ error: "Nhập lý do làm thêm giờ, tối đa 500 ký tự" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const [existing] = await svc.listOvertimeRequests({ user_email: targetEmail, day_key, deleted_at: null })
    if (existing) return res.status(409).json({ error: "Ngày này đã có đăng ký OT. Vui lòng kiểm tra danh sách." })

    const request = await svc.createOvertimeRequests({
      user_email: targetEmail,
      day_key,
      duration_min,
      source: isOwnRequest ? "employee" : "manual",
      status: "pending",
      note: reason || null,
    })
    res.json({ request })
  } catch (e: any) {
    // The unique user/day index also protects against concurrent submissions.
    if ([e.code, e.cause?.code, e.originalException?.code].includes("23505")) {
      return res.status(409).json({ error: "Ngày này đã có đăng ký OT. Vui lòng kiểm tra danh sách." })
    }
    res.status(500).json({ error: e.message })
  }
}
