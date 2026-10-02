import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { ROLE_PRESETS } from "../../../../admin/lib/permissions"

function resolvePerms(metadata: any): string[] {
  const explicit: string[] = Array.isArray(metadata?.permissions) ? metadata.permissions : []
  const role: string = metadata?.role ?? ""
  const fromRole: string[] = role && ROLE_PRESETS[role] ? ROLE_PRESETS[role] : []
  return [...new Set([...fromRole, ...explicit])]
}

/** Phút trong ngày theo giờ VN của một thời điểm. */
function vnMinutes(iso: string | Date): number {
  const vn = new Date(new Date(iso).getTime() + 7 * 3600_000)
  return vn.getUTCHours() * 60 + vn.getUTCMinutes()
}
function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}
function vnHHmm(iso: string | Date): string {
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(11, 16)
}
/** Ngày VN (YYYY-MM-DD) của một thời điểm. */
function vnDay(iso: string | Date): string {
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10)
}

function csvEscape(v: any): string {
  const s = String(v ?? "")
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Khớp team/route.ts: T7 làm nửa ngày (config.half_day_saturdays) tan ca 12:00.
const HALF_DAY_SHIFT_END = "12:00"
const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]

/**
 * GET /admin/cham-cong/export?month=2026-07 — bảng chấm công tháng (CSV) cho kế toán.
 *
 * Mỗi dòng = 1 nhân viên × 1 ngày làm việc, KỂ CẢ ngày vắng. Bản cũ bỏ qua ngày không
 * có lượt chấm nên kế toán không thấy ngày vắng, và chỉ lấy người ĐANG có quyền chấm
 * công nên người nghỉ việc giữa tháng (đã gỡ quyền) mất trắng ngày công đã làm.
 *
 * Danh sách nhân viên = có quyền chấm công ∪ có lượt chấm trong tháng ∪ có đơn nghỉ
 * được duyệt trong tháng. Mỗi người chỉ xuất các ngày nằm trong khoảng làm việc:
 * từ ngày tạo tài khoản tới metadata.offboarded_at (nếu đã nghỉ) — tránh tính vắng oan
 * cho ngày trước khi vào làm / sau khi nghỉ. Không xuất ngày trong tương lai.
 *
 * Cột "Trạng thái" chỉ MÔ TẢ dữ liệu chấm công, chưa quy ra số công: quy tắc tính công
 * (thiếu giờ ra tính bao nhiêu, đủ công bao nhiêu giờ) chưa được chốt.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const month = String((req.query as any).month || "")
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month phai dang YYYY-MM" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const userModule = req.scope.resolve(Modules.USER)
    const allUsers = await userModule.listUsers({}, { select: ["email", "first_name", "last_name", "metadata", "created_at"] })

    const [configRows, monthLogs, approvedLeaves, approvedOt] = await Promise.all([
      svc.listChamCongConfigs({ id: "default" }),
      svc.listChamCongLogs({ day_key: { $gte: `${month}-01`, $lt: `${month}-32` }, deleted_at: null }, { order: { created_at: "ASC" } }),
      svc.listLeaveRequests({ status: "approved", deleted_at: null }, {}),
      svc.listOvertimeRequests({ day_key: { $gte: `${month}-01`, $lt: `${month}-32` }, status: "approved", deleted_at: null }, {}),
    ])
    const config = configRows[0] || { shift_start: "08:30", shift_end: "17:30", late_grace_min: 5, work_days: [1, 2, 3, 4, 5, 6], half_day_saturdays: [] }

    const [y, m] = month.split("-").map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const monthStart = `${month}-01`
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`
    const today = vnDay(new Date())

    // Đơn nghỉ giao với ngày VN [00:00, 00:00 hôm sau).
    const leaveCovers = (email: string, dayKey: string) => {
      const dayStart = new Date(`${dayKey}T00:00:00+07:00`).getTime()
      const dayEnd = dayStart + 86400_000
      return approvedLeaves.some((l: any) =>
        l.requester_email === email &&
        new Date(l.start_at).getTime() < dayEnd &&
        new Date(l.end_at).getTime() > dayStart
      )
    }

    const emailsWithLogs = new Set(monthLogs.map((l: any) => l.user_email))
    const emailsWithLeave = new Set(
      approvedLeaves
        .filter((l: any) => vnDay(l.start_at) <= monthEnd && vnDay(l.end_at) >= monthStart)
        .map((l: any) => l.requester_email)
    )
    // Tài khoản hệ thống (AI agent, admin chung, test) có quyền chấm công qua role nhưng
    // không phải nhân viên — bỏ khỏi bảng công trừ khi thực sự có chấm, nếu không mỗi
    // tài khoản sinh ra cả tháng dòng "Vắng".
    const laTaiKhoanHeThong = (u: any) => {
      const e = String(u.email || "").toLowerCase()
      return (u.metadata as any)?.role === "ai-agent" || /(^|-)agent@/.test(e) ||
        /^test\d*@/.test(e) || e === "admin@yourmail.com"
    }
    const staff = allUsers.filter((u: any) => {
      if (emailsWithLogs.has(u.email) || emailsWithLeave.has(u.email)) return true
      return !laTaiKhoanHeThong(u) && resolvePerms(u.metadata).includes("page.cham-cong-nv.checkin")
    })

    const byUserDay: Record<string, Record<string, any[]>> = {}
    for (const log of monthLogs) {
      (byUserDay[log.user_email] ||= {})[log.day_key] ||= []
      byUserDay[log.user_email][log.day_key].push(log)
    }
    const otByUserDay: Record<string, Record<string, number>> = {}
    for (const ot of approvedOt) {
      (otByUserDay[ot.user_email] ||= {})[ot.day_key] = ot.approved_duration_min ?? ot.duration_min
    }

    const rows: string[] = [
      "Mã NV,Họ tên,Ngày,Thứ,Giờ vào,Giờ ra,Trạng thái,Đi muộn (phút),Về sớm (phút),Số giờ làm,OT duyệt (phút),Nghỉ có đơn,Ghi chú",
    ]
    const workDays: number[] = config.work_days || [1, 2, 3, 4, 5, 6]

    for (const u of staff) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
      const userLogs = byUserDay[u.email] || {}
      const startDay = u.created_at ? vnDay(u.created_at) : monthStart
      const offboarded: string | null = (u.metadata as any)?.offboarded_at || null

      for (let day = 1; day <= daysInMonth; day++) {
        const dayKey = `${month}-${String(day).padStart(2, "0")}`
        if (dayKey > today) break
        if (dayKey < startDay) continue
        if (offboarded && dayKey > offboarded) continue

        const logs = userLogs[dayKey] || []
        const dow = new Date(`${dayKey}T12:00:00Z`).getUTCDay()
        const isWorkDay = workDays.includes(dow)
        // Ngày nghỉ (CN...) mà không có lượt chấm thì không cần dòng; có chấm thì vẫn ghi
        // để thấy "làm ngày nghỉ".
        if (!isWorkDay && logs.length === 0) continue

        const firstIn = logs.find((l: any) => l.action === "in")
        const lastOut = [...logs].reverse().find((l: any) => l.action === "out")
        const onLeave = leaveCovers(u.email, dayKey)
        const shiftEnd = (config.half_day_saturdays || []).includes(dayKey) ? HALF_DAY_SHIFT_END : config.shift_end

        const late = firstIn
          ? Math.max(0, vnMinutes(firstIn.created_at) - hhmmToMin(config.shift_start) - (config.late_grace_min ?? 0))
          : 0
        const early = lastOut ? Math.max(0, hhmmToMin(shiftEnd) - vnMinutes(lastOut.created_at)) : 0
        const hours = firstIn && lastOut && new Date(lastOut.created_at) > new Date(firstIn.created_at)
          ? ((new Date(lastOut.created_at).getTime() - new Date(firstIn.created_at).getTime()) / 3600_000).toFixed(1)
          : ""

        let status: string
        const notes: string[] = []
        if (!isWorkDay) status = "Làm ngày nghỉ"
        else if (onLeave && logs.length === 0) status = "Nghỉ phép"
        else if (logs.length === 0) status = "Vắng"
        else if (!firstIn) status = "Thiếu giờ vào"
        else if (!lastOut) status = dayKey === today ? "Chưa chấm ra" : "Thiếu giờ ra"
        else if (late > 0 && early > 0) status = "Đi muộn + về sớm"
        else if (late > 0) status = "Đi muộn"
        else if (early > 0) status = "Về sớm"
        else status = "Đúng giờ"
        if (onLeave && logs.length > 0) notes.push("Có đơn nghỉ nhưng vẫn chấm công")
        if (offboarded && dayKey === offboarded) notes.push("Ngày nghỉ việc")
        if (lastOut && firstIn && new Date(lastOut.created_at) < new Date(firstIn.created_at)) {
          notes.push("Giờ ra trước giờ vào — cần kiểm tra")
        }

        rows.push([
          csvEscape(u.email.split("@")[0]),
          csvEscape(name),
          dayKey,
          THU[dow],
          firstIn ? vnHHmm(firstIn.created_at) : "",
          lastOut ? vnHHmm(lastOut.created_at) : "",
          status,
          String(late),
          String(early),
          hours,
          String(otByUserDay[u.email]?.[dayKey] || 0),
          onLeave ? "1" : "0",
          csvEscape(notes.join("; ")),
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
