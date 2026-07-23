import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { ROLE_PRESETS } from "../../../../admin/lib/permissions"

function resolvePerms(metadata: any): string[] {
  const explicit: string[] = Array.isArray(metadata?.permissions) ? metadata.permissions : []
  const role: string = metadata?.role ?? ""
  const fromRole: string[] = role && ROLE_PRESETS[role] ? ROLE_PRESETS[role] : []
  return [...new Set([...fromRole, ...explicit])]
}

function minutesLate(firstInIso: string | null, shiftStart: string, graceMin: number): number {
  if (!firstInIso) return 0
  const d = new Date(firstInIso)
  const vn = new Date(d.getTime() + 7 * 3600_000)
  const [h, m] = shiftStart.split(":").map(Number)
  const actualMin = vn.getUTCHours() * 60 + vn.getUTCMinutes()
  return Math.max(0, actualMin - (h * 60 + m) - graceMin)
}

function csvEscape(v: any): string {
  const s = String(v ?? "")
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /admin/cham-cong/export?month=2026-07 — báo cáo chấm công tháng ra CSV cho kế toán:
// mỗi dòng 1 nhân viên/ngày làm việc, kèm công/muộn/OT (đã duyệt)/nghỉ.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const month = String((req.query as any).month || "")
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month phai dang YYYY-MM" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const userModule = req.scope.resolve(Modules.USER)
    const allUsers = await userModule.listUsers({}, { select: ["email", "first_name", "last_name", "metadata"] })
    const staff = allUsers.filter((u: any) => resolvePerms(u.metadata).includes("page.cham-cong-nv.checkin"))
    const nameByEmail: Record<string, string> = {}
    for (const u of staff) nameByEmail[u.email] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email

    const [configRows, monthLogs, approvedLeaves, approvedOt] = await Promise.all([
      svc.listChamCongConfigs({ id: "default" }),
      svc.listChamCongLogs({ day_key: { $gte: `${month}-01`, $lt: `${month}-32` }, deleted_at: null }, { order: { created_at: "ASC" } }),
      svc.listLeaveRequests({ status: "approved", deleted_at: null }, {}),
      svc.listOvertimeRequests({ day_key: { $gte: `${month}-01`, $lt: `${month}-32` }, status: "approved", deleted_at: null }, {}),
    ])
    const config = configRows[0] || { shift_start: "08:30", late_grace_min: 5 }

    const byUserDay: Record<string, Record<string, any[]>> = {}
    for (const log of monthLogs) {
      (byUserDay[log.user_email] ||= {})[log.day_key] ||= []
      byUserDay[log.user_email][log.day_key].push(log)
    }
    const otByUserDay: Record<string, Record<string, number>> = {}
    for (const ot of approvedOt) {
      (otByUserDay[ot.user_email] ||= {})[ot.day_key] = ot.approved_duration_min ?? ot.duration_min
    }

    const [y, m] = month.split("-").map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()

    const rows: string[] = ["Mã NV,Họ tên,Ngày,Giờ vào,Giờ ra,Đi muộn (phút),OT duyệt (phút),Nghỉ có đơn"]

    for (const u of staff) {
      const userLogs = byUserDay[u.email] || {}
      for (let day = 1; day <= daysInMonth; day++) {
        const dayKey = `${month}-${String(day).padStart(2, "0")}`
        const dow = new Date(`${dayKey}T12:00:00`).getDay()
        if (!(config.work_days || [1, 2, 3, 4, 5, 6]).includes(dow)) continue

        const logs = userLogs[dayKey] || []
        const firstIn = logs.find((l: any) => l.action === "in")
        const lastOut = [...logs].reverse().find((l: any) => l.action === "out")
        const dateObj = new Date(`${dayKey}T00:00:00Z`)
        const onLeave = approvedLeaves.some((l: any) =>
          l.requester_email === u.email && new Date(l.start_at) <= dateObj && new Date(l.end_at) >= dateObj
        )
        if (!firstIn && !onLeave) continue // ngày chưa tới hoặc không có dữ liệu thì bỏ qua, tránh CSV toàn dòng trống

        const late = minutesLate(firstIn?.created_at || null, config.shift_start, config.late_grace_min)
        const ot = otByUserDay[u.email]?.[dayKey] || 0

        rows.push([
          csvEscape(u.email.split("@")[0]),
          csvEscape(nameByEmail[u.email]),
          dayKey,
          firstIn ? new Date(new Date(firstIn.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 16) : "",
          lastOut ? new Date(new Date(lastOut.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 16) : "",
          String(late),
          String(ot),
          onLeave ? "1" : "0",
        ].join(","))
      }
    }

    const csv = "﻿" + rows.join("\n") // BOM để Excel VN mở đúng UTF-8
    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", `attachment; filename="cham-cong-${month}.csv"`)
    res.send(csv)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
