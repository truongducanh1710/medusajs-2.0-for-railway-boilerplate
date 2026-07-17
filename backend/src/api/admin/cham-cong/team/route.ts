import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { vnDayKey } from "../../mkt-chat/_presence"
import { ROLE_PRESETS } from "../../../../admin/lib/permissions"

function resolvePerms(metadata: any): string[] {
  const explicit: string[] = Array.isArray(metadata?.permissions) ? metadata.permissions : []
  const role: string = metadata?.role ?? ""
  const fromRole: string[] = role && ROLE_PRESETS[role] ? ROLE_PRESETS[role] : []
  return [...new Set([...fromRole, ...explicit])]
}

// T7 nửa ngày (HR chọn thủ công đầu tháng) kết thúc buổi sáng — mặc định 12:00 nếu
// công ty chưa cấu hình giờ ra riêng, giữ nguyên giờ ra full-day cho các ngày khác.
const HALF_DAY_SHIFT_END = "12:00"
function effectiveShiftEnd(dateKey: string, config: { shift_end: string; half_day_saturdays?: string[] }): string {
  return (config.half_day_saturdays || []).includes(dateKey) ? HALF_DAY_SHIFT_END : config.shift_end
}

function minutesLate(firstInIso: string | null, shiftStart: string, graceMin: number): number {
  if (!firstInIso) return 0
  const d = new Date(firstInIso)
  // Giờ VN — day_key/created_at lưu UTC, chuyển sang giờ VN để so với shift_start "HH:mm".
  const vn = new Date(d.getTime() + 7 * 3600_000)
  const [h, m] = shiftStart.split(":").map(Number)
  const shiftMin = h * 60 + m
  const actualMin = vn.getUTCHours() * 60 + vn.getUTCMinutes()
  return Math.max(0, actualMin - shiftMin - graceMin)
}

// GET /admin/cham-cong/team?date=2026-07-18&month=2026-07 — bảng toàn công ty cho quản lý
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const date = String((req.query as any).date || vnDayKey())
    const month = String((req.query as any).month || date.slice(0, 7))

    const svc = req.scope.resolve("mktTaskModule") as any
    const userModule = req.scope.resolve(Modules.USER)
    const allUsers = await userModule.listUsers({}, { select: ["email", "first_name", "last_name", "metadata"] })
    const staff = allUsers.filter((u: any) => resolvePerms(u.metadata).includes("page.cham-cong-nv.checkin"))
    const nameByEmail: Record<string, string> = {}
    for (const u of staff) nameByEmail[u.email] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email

    const [configRows, dayLogs, monthLogs, approvedLeaves, last7Logs] = await Promise.all([
      svc.listChamCongConfigs({ id: "default" }),
      svc.listChamCongLogs({ day_key: date, deleted_at: null }, { order: { created_at: "ASC" } }),
      svc.listChamCongLogs({ day_key: { $gte: `${month}-01`, $lte: date }, deleted_at: null }, { order: { created_at: "ASC" } }),
      svc.listLeaveRequests({ status: "approved", deleted_at: null }, {}),
      svc.listChamCongLogs({}, { order: { created_at: "ASC" }, take: 5000 }),
    ])

    const config = configRows[0] || { shift_start: "08:30", shift_end: "17:30", work_days: [1, 2, 3, 4, 5, 6], late_grace_min: 5, half_day_saturdays: [] }

    // ── Bảng chi tiết ngày đã chọn ──────────────────────────────────────────
    const byUserDay: Record<string, any[]> = {}
    for (const log of dayLogs) {
      (byUserDay[log.user_email] ||= []).push(log)
    }
    const dateObj = new Date(`${date}T00:00:00Z`)
    const leavesOnDate = approvedLeaves.filter((l: any) => new Date(l.start_at) <= dateObj && new Date(l.end_at) >= dateObj)
    const leaveEmails = new Set(leavesOnDate.map((l: any) => l.requester_email))

    const dayRows = staff.map((u: any) => {
      const logs = byUserDay[u.email] || []
      const firstIn = logs.find((l: any) => l.action === "in") || null
      const lastOut = [...logs].reverse().find((l: any) => l.action === "out") || null
      const late = minutesLate(firstIn?.created_at || null, config.shift_start, config.late_grace_min)
      return {
        email: u.email,
        name: nameByEmail[u.email],
        first_in: firstIn?.created_at || null,
        last_out: lastOut?.created_at || null,
        lat: firstIn?.lat ?? null,
        lng: firstIn?.lng ?? null,
        late_minutes: late,
        on_leave: leaveEmails.has(u.email),
      }
    })

    const statOnTime = dayRows.filter((r: any) => r.first_in && r.late_minutes === 0).length
    const statLate = dayRows.filter((r: any) => r.late_minutes > 0).length
    const statMissing = dayRows.filter((r: any) => !r.first_in && !r.on_leave).length

    // ── Stacked chart 7 ngày gần nhất tính tới `date` ──────────────────────
    const days: string[] = []
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(dateObj.getTime() - i * 86400_000)
      days.push(dt.toISOString().slice(0, 10))
    }
    const byUserDayAll: Record<string, Record<string, any[]>> = {}
    for (const log of last7Logs) {
      if (!days.includes(log.day_key)) continue
      (byUserDayAll[log.day_key] ||= {})[log.user_email] ||= []
      byUserDayAll[log.day_key][log.user_email].push(log)
    }
    const last7days = days.map((day) => {
      let onTime = 0, late = 0, missing = 0
      for (const u of staff) {
        const logs = byUserDayAll[day]?.[u.email] || []
        const firstIn = logs.find((l: any) => l.action === "in")
        if (!firstIn) { missing++; continue }
        const m = minutesLate(firstIn.created_at, config.shift_start, config.late_grace_min)
        if (m > 0) late++; else onTime++
      }
      return { date: day, on_time: onTime, late, missing }
    })

    // ── Top check-in sớm nhất / về sớm hôm nay ─────────────────────────────
    const topEarly = dayRows.filter((r: any) => r.first_in).sort((a: any, b: any) => a.first_in.localeCompare(b.first_in)).slice(0, 5)
    const [eh, em] = effectiveShiftEnd(date, config).split(":").map(Number)
    const earlyLeavers = dayRows.filter((r: any) => {
      if (!r.last_out) return false
      const vn = new Date(new Date(r.last_out).getTime() + 7 * 3600_000)
      return vn.getUTCHours() * 60 + vn.getUTCMinutes() < eh * 60 + em
    })

    // ── Tổng hợp tháng per người ────────────────────────────────────────────
    const byUserMonth: Record<string, any[]> = {}
    for (const log of monthLogs) (byUserMonth[log.user_email] ||= []).push(log)
    const monthSummary = staff.map((u: any) => {
      const logs = byUserMonth[u.email] || []
      const byDay: Record<string, any[]> = {}
      for (const l of logs) (byDay[l.day_key] ||= []).push(l)
      let workedDays = 0, lateDays = 0
      for (const dayKey of Object.keys(byDay)) {
        const dayL = byDay[dayKey]
        const firstIn = dayL.find((l: any) => l.action === "in")
        if (firstIn) {
          workedDays++
          if (minutesLate(firstIn.created_at, config.shift_start, config.late_grace_min) > 0) lateDays++
        }
      }
      const leaveDays = approvedLeaves
        .filter((l: any) => l.requester_email === u.email && l.start_at.slice(0, 7) <= month && l.end_at.slice(0, 7) >= month)
        .reduce((s: number, l: any) => s + (new Date(l.end_at).getTime() - new Date(l.start_at).getTime()) / (8 * 3600_000), 0)
      return { email: u.email, name: nameByEmail[u.email], worked_days: workedDays, late_days: lateDays, leave_days: Number(leaveDays.toFixed(2)) }
    })

    res.json({
      config,
      date,
      stats: { on_time: statOnTime, late: statLate, missing: statMissing },
      last7days,
      day_rows: dayRows,
      top_early: topEarly,
      early_leavers: earlyLeavers,
      month_summary: monthSummary,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
