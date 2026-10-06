import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { vnDayKey } from "../../../mkt-chat/_presence"
import { ROLE_PRESETS } from "../../../../../admin/lib/permissions"
import { leaveWorkDays } from "../../../../../admin/lib/leave-days"
import { khongChamCong } from "../../_lib"
import { findEmployeeProfile } from "../../../leave-balance/route"

function resolvePerms(metadata: any): string[] {
  const explicit: string[] = Array.isArray(metadata?.permissions) ? metadata.permissions : []
  const role: string = metadata?.role ?? ""
  const fromRole: string[] = role && ROLE_PRESETS[role] ? ROLE_PRESETS[role] : []
  return [...new Set([...fromRole, ...explicit])]
}

// Phép năm (và nghỉ lễ khi có) được trả lương; các loại nghỉ còn lại (không lương, ốm, khác)
// tính vào "Nghỉ không lương" như bảng công kế toán đang làm tay.
const PAID_LEAVE = new Set(["phep_nam"])

/**
 * GET /admin/cham-cong/team/grid?month=2026-10 — bảng công dạng lưới (người × ngày), cùng
 * bố cục file Excel kế toán: mỗi ô là số công của ngày, cuối dòng là Công thực tế, Nghỉ phép,
 * Công tính lương, Nghỉ không lương.
 *
 * Quy tắc 1 ô (chỉ ngày làm việc đã qua):
 *  - Có chấm vào = 1 công (T7 nửa ngày cũng 1); trừ đi phần nghỉ có đơn trong ngày.
 *  - Có đơn làm online đã duyệt mà không chấm = 1 công.
 *  - Không chấm, không đơn = 0 (vắng).
 * Công tính lương = công thực tế + nghỉ phép; Nghỉ không lương = số ngày công chuẩn − công tính lương.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const today = vnDayKey()
    const month = String((req.query as any).month || today.slice(0, 7))
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month phai dang YYYY-MM" })
    const [y, m] = month.split("-").map(Number)
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const monthStart = `${month}-01`
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`

    const svc = req.scope.resolve("mktTaskModule") as any
    const userModule = req.scope.resolve(Modules.USER)
    const [allUsers, [config], logs, leaves, profiles] = await Promise.all([
      userModule.listUsers({}, { select: ["email", "first_name", "last_name", "metadata"] }),
      svc.listChamCongConfigs({ id: "default" }),
      svc.listChamCongLogs({ day_key: { $gte: monthStart, $lte: monthEnd }, deleted_at: null }, { order: { created_at: "ASC" } }),
      svc.listLeaveRequests({ status: "approved", deleted_at: null }, {}),
      svc.listEmployeeProfiles({ deleted_at: null }),
    ])
    const cfg = config || { work_days: [1, 2, 3, 4, 5, 6], half_day_saturdays: [] }
    const workDays: number[] = cfg.work_days || [1, 2, 3, 4, 5, 6]
    const halfSat = new Set<string>(cfg.half_day_saturdays || [])

    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const key = `${month}-${String(i + 1).padStart(2, "0")}`
      const dow = new Date(`${key}T12:00:00Z`).getUTCDay()
      return { key, dow, work: workDays.includes(dow), half: halfSat.has(key), past: key <= today }
    })

    const staff = allUsers.filter((u: any) => !khongChamCong(u) && resolvePerms(u.metadata).includes("page.cham-cong-nv.checkin"))

    const logsBy: Record<string, Record<string, any[]>> = {}
    for (const l of logs) ((logsBy[l.user_email] ||= {})[l.day_key] ||= []).push(l)

    const rows = staff.map((u: any) => {
      const profile = findEmployeeProfile(profiles, u.email)
      const myEmails = new Set([u.email.toLowerCase(),
        ...[profile?.email_cong_ty, profile?.email_ca_nhan].filter(Boolean).map((x: string) => x.toLowerCase())])
      const myLeaves = leaves.filter((l: any) => myEmails.has(String(l.requester_email).toLowerCase()))

      let congThucTe = 0, nghiPhep = 0, standard = 0
      const cells = days.map((d) => {
        const dayLogs = logsBy[u.email]?.[d.key] || []
        const hasIn = dayLogs.some((l: any) => l.action === "in")
        const hasOut = dayLogs.some((l: any) => l.action === "out")
        if (!d.past) return { v: null, kind: "future" }
        if (!d.work) return hasIn ? { v: 1, kind: "work_off" } : { v: null, kind: "off" }

        // Phần nghỉ có đơn trong ngày, theo loại.
        const dayStart = new Date(`${d.key}T00:00:00+07:00`)
        const dayEnd = new Date(dayStart.getTime() + 86400_000)
        let paid = 0, unpaid = 0, online = 0
        for (const l of myLeaves) {
          const s = new Date(Math.max(new Date(l.start_at).getTime(), dayStart.getTime()))
          const e = new Date(Math.min(new Date(l.end_at).getTime(), dayEnd.getTime()))
          if (e <= s) continue
          const n = leaveWorkDays(s, e, cfg)
          if (l.leave_type === "online") online += n
          else if (PAID_LEAVE.has(l.leave_type)) paid += n
          else unpaid += n
        }
        paid = Math.min(1, paid)
        const leaveTotal = Math.min(1, paid + unpaid)

        // Hôm nay chưa chấm, chưa có đơn: chưa kết luận vắng, không tính vào công chuẩn.
        if (d.key === today && !hasIn && online === 0 && leaveTotal === 0) return { v: null, kind: "today" }
        standard += 1

        let cong = 0
        if (hasIn) cong = Math.max(0, 1 - leaveTotal)
        else if (online > 0) cong = Math.min(1 - leaveTotal, online)
        cong = Math.round(cong * 100) / 100
        congThucTe += cong
        nghiPhep += paid

        const kind = hasIn
          ? (hasOut || d.key === today ? (leaveTotal > 0 ? "partial" : "work") : "no_out")
          : online > 0 ? "online"
          : paid > 0 ? "paid_leave"
          : unpaid > 0 ? "unpaid_leave"
          : "absent"
        return { v: cong, kind, paid: paid || undefined, unpaid: unpaid || undefined }
      })

      const r2 = (n: number) => Math.round(n * 100) / 100
      const congLuong = r2(congThucTe + nghiPhep)
      return {
        email: u.email,
        ma_nv: profile?.ma_nv ?? null,
        name: profile?.ho_ten || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
        chuc_vu: [profile?.chuc_vu, profile?.team].filter(Boolean).join(" · ") || null,
        cells,
        cong_thuc_te: r2(congThucTe),
        nghi_phep: r2(nghiPhep),
        cong_tinh_luong: congLuong,
        nghi_khong_luong: r2(Math.max(0, standard - congLuong)),
        cong_chuan: standard,
      }
    }).sort((a: any, b: any) => String(a.ma_nv ?? "~").localeCompare(String(b.ma_nv ?? "~")))

    res.json({ month, today, days, rows })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
