import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getCurrentUserEmail, userHasPerm } from "../cham-cong/_lib"
import { leaveWorkDays, splitAtWorkDays } from "../../../admin/lib/leave-days"
import { computeLeaveQuota } from "../leave-balance/route"

const LEAVE_TYPES = new Set(["khong_luong", "phep_nam", "om", "khac", "online"])

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

    const [requests, [config]] = await Promise.all([
      svc.listLeaveRequests(filter, { order: { created_at: "DESC" } }),
      svc.listChamCongConfigs({ id: "default" }),
    ])
    // Số ngày tính ở server vì cần cấu hình T7 nửa ngày (sáng T7 nửa ngày = 1 công).
    // Tên người gửi / người duyệt để hiện thay cho email trần.
    const users = await req.scope.resolve(Modules.USER).listUsers({}, { select: ["email", "first_name", "last_name"] })
    const nameOf: Record<string, string> = {}
    for (const u of users as any[]) nameOf[String(u.email).toLowerCase()] = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email
    const nm = (e: string | null) => (e ? nameOf[e.toLowerCase()] || e : null)
    const out = requests.map((r: any) => ({
      ...r,
      days: leaveWorkDays(r.start_at, r.end_at, config || {}),
      requester_name: nm(r.requester_email),
      reviewer_name: nm(r.reviewer_email),
    }))
    // Tab Chờ duyệt: đơn phép năm kèm số phép người đó còn (không tính chính đơn này), để
    // quản lý thấy vượt phép TRƯỚC khi bấm duyệt.
    if (scope === "pending") {
      for (const r of out) {
        if (r.leave_type !== "phep_nam" || r.status !== "pending") continue
        const q = await computeLeaveQuota(svc, r.requester_email, new Date(r.start_at), r.id)
        r.quota = { quarter: q.quarter, remaining_days: q.remaining_days, has_profile: q.has_profile }
      }
    }
    res.json({ requests: out })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/leave-request — tạo đơn xin nghỉ mới
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const { leave_type, start_at, end_at, reason, split } = req.body as any
    if (!LEAVE_TYPES.has(leave_type)) {
      return res.status(400).json({ error: "leave_type khong hop le" })
    }
    const start = new Date(start_at)
    const end = new Date(end_at)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return res.status(400).json({ error: "Khoang thoi gian khong hop le" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any

    // Phép năm không được ứng trước: số ngày xin + đơn đang chờ duyệt không vượt số còn lại
    // (tính tới tháng của ngày bắt đầu nghỉ).
    if (leave_type === "phep_nam") {
      const quota = await computeLeaveQuota(svc, email, start)
      const days = leaveWorkDays(start, end, quota.config || {})
      const available = quota.remaining_days - quota.pending_days
      // split=true: phần còn phép → phep_nam, phần vượt → khong_luong (2 đơn), thay vì từ chối.
      if (days > available + 1e-9 && split === true) {
        const at = splitAtWorkDays(start, end, Math.max(0, available), quota.config || {})
        const base = { requester_email: email, reason: reason ? String(reason).slice(0, 1000) : null, status: "pending" }
        const created: any[] = []
        if (at > start) created.push(await svc.createLeaveRequests({ ...base, leave_type: "phep_nam", start_at: start, end_at: at }))
        created.push(await svc.createLeaveRequests({ ...base, leave_type: "khong_luong", start_at: at > start ? at : start, end_at: end }))
        return res.json({ request: created[0], requests: created })
      }
      if (days > available + 1e-9) {
        return res.status(400).json({
          error: `Không đủ phép năm: xin ${days} ngày, quý ${quota.quarter} còn ${Math.max(0, available)} ngày`
            + (quota.pending_days > 0 ? ` (đã trừ ${quota.pending_days} ngày đang chờ duyệt)` : "")
            + ". Mỗi tháng có 1 phép, không ứng trước tháng sau — chọn loại nghỉ khác.",
        })
      }
    }

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

