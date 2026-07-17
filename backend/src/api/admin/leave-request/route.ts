import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail, userHasPerm } from "../cham-cong/_lib"

const LEAVE_TYPES = new Set(["khong_luong", "phep_nam", "om", "khac"])

export async function userHasApprovePerm(req: MedusaRequest, email: string): Promise<boolean> {
  return userHasPerm(req, email, "page.leave-request.approve")
}

// GET /admin/leave-request?scope=mine|pending|approved
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const scope = String((req.query as any).scope || "mine")
    const svc = req.scope.resolve("mktTaskModule") as any

    let filter: any = { deleted_at: null }
    if (scope === "mine") {
      filter.requester_email = email
    } else if (scope === "pending" || scope === "approved") {
      if (!(await userHasApprovePerm(req, email))) {
        return res.status(403).json({ error: "Ban khong co quyen duyet don" })
      }
      filter.status = scope === "pending" ? "pending" : { $in: ["approved", "rejected"] }
    } else {
      return res.status(400).json({ error: "scope khong hop le" })
    }

    const requests = await svc.listLeaveRequests(filter, { order: { created_at: "DESC" } })
    res.json({ requests })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/leave-request — tạo đơn xin nghỉ mới
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const { leave_type, start_at, end_at, reason } = req.body as any
    if (!LEAVE_TYPES.has(leave_type)) {
      return res.status(400).json({ error: "leave_type khong hop le" })
    }
    const start = new Date(start_at)
    const end = new Date(end_at)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return res.status(400).json({ error: "Khoang thoi gian khong hop le" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const request = await svc.createLeaveRequests({
      requester_email: email,
      leave_type,
      start_at: start,
      end_at: end,
      reason: reason ? String(reason).slice(0, 1000) : null,
      status: "pending",
    })

    res.json({ request })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
