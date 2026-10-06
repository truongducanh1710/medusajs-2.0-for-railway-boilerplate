import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getCurrentUserEmail, userHasPerm } from "../cham-cong/_lib"
import { leaveWorkDays, splitAtWorkDays } from "../../../admin/lib/leave-days"
import { computeLeaveQuota } from "../leave-balance/route"
import { findEmployeeProfile } from "../../../lib/employee"
import { notifyTelegramByEmail } from "../../../lib/notify"

const TYPE_LABEL: Record<string, string> = {
  khong_luong: "Nghỉ không lương", phep_nam: "Nghỉ phép năm", om: "Nghỉ ốm", khac: "Khác", online: "Xin làm online",
}

/**
 * Báo Telegram cho QUẢN LÝ TEAM của người gửi khi có đơn mới: hồ sơ cùng team, đang làm việc,
 * chức vụ có chữ "quản lý" (hiện chỉ có Quản Lý kho — team Kho vận). Không gửi cho chính người
 * gửi. Best-effort: lỗi gửi không làm hỏng việc tạo đơn.
 */
async function notifyTeamManager(req: MedusaRequest, svc: any, requesterEmail: string, created: any[]) {
  try {
    const profiles = await svc.listEmployeeProfiles({ deleted_at: null })
    const me = findEmployeeProfile(profiles, requesterEmail)
    if (!me?.team) return
    const managers = profiles.filter((p: any) => p.team === me.team && p.trang_thai === "active"
      && /quản\s*lý/i.test(String(p.chuc_vu || "")) && p.id !== me.id)
    if (managers.length === 0) return

    const userModule = req.scope.resolve(Modules.USER)
    const users = await userModule.listUsers({}, { select: ["email"] })
    const managerIds = new Set(managers.map((m: any) => m.id))
    const to = (users as any[]).filter((u) => managerIds.has(findEmployeeProfile(profiles, u.email)?.id)).map((u) => u.email)
    if (to.length === 0) return

    const [config] = await svc.listChamCongConfigs({ id: "default" })
    const fmt = (d: any) => new Date(d).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })
    const lines = created.map((r: any) =>
      `• ${TYPE_LABEL[r.leave_type] || r.leave_type}: ${fmt(r.start_at)} → ${fmt(r.end_at)} (${leaveWorkDays(r.start_at, r.end_at, config || {})} ngày)`)
    const reason = created[0]?.reason ? `\nLý do: ${String(created[0].reason).slice(0, 300)}` : ""
    const text = `📝 <b>Đơn mới chờ duyệt</b> — ${me.ho_ten} (${me.team})\n${lines.join("\n")}${reason}`
      + `\n\nXem tại: https://api.phanviet.vn/app/cham-cong-nhan-vien`
    await notifyTelegramByEmail(userModule, to, text, "leave_request")
  } catch (e: any) {
    console.warn("[leave-request] notifyTeamManager:", e.message)
  }
}

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
        await notifyTeamManager(req, svc, email, created)
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

    await notifyTeamManager(req, svc, email, [request])
    res.json({ request })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

