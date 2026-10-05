import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail, userHasPerm } from "../cham-cong/_lib"
import { leaveWorkDays, vnQuarterOf } from "../../../admin/lib/leave-days"

// Rút gọn email về "tên người": thulth@phanviet.vn, thulth.phv@gmail.com, khaitd1.phv@… → thulth / khaitd.
// Tài khoản đăng nhập đã chuyển sang @phanviet.vn nhưng hồ sơ nhân sự còn ghi email .phv@gmail.com
// cũ, nên phải khớp theo phần này — khớp email trần thì gần như ai cũng ra 0 phép.
const emailStem = (e: string) => e.toLowerCase().split("@")[0].replace(/\.phv$/, "").replace(/\d+$/, "")

export function findEmployeeProfile(profiles: any[], email: string): any | null {
  const e = email.toLowerCase()
  const emailsOf = (p: any) => [p.email_cong_ty, p.email_ca_nhan].filter(Boolean).map((x: string) => x.toLowerCase())
  return profiles.find((p) => emailsOf(p).includes(e))
    ?? profiles.find((p) => p.email_cong_ty && emailStem(p.email_cong_ty) === emailStem(e))
    ?? null
}

// GET /admin/leave-balance — phép năm của QUÝ hiện tại; ?email= để manager/HR xem người khác
// (cần page.nhan-su.manage).
//
// Quy định: mỗi tháng (sau ngày chính thức) có phep_nam_per_month ngày, cộng dồn trong quý
// (tối đa 3), sang quý mới thì RESET — phép quý trước không dùng là mất. Tính trực tiếp từ hồ
// sơ nhân sự + đơn phép năm đã duyệt, không đọc bảng leave_balance cộng dồn theo năm cũ.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const targetEmailRaw = (req.query as any).email ? String((req.query as any).email) : null
    let targetEmail = email
    if (targetEmailRaw && targetEmailRaw !== email) {
      if (!(await userHasPerm(req, email, "page.nhan-su.manage"))) {
        return res.status(403).json({ error: "Ban khong co quyen xem phep cua nguoi khac" })
      }
      targetEmail = targetEmailRaw
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const [[config], profiles, leaves] = await Promise.all([
      svc.listChamCongConfigs({ id: "default" }),
      svc.listEmployeeProfiles({ deleted_at: null }),
      svc.listLeaveRequests({ leave_type: "phep_nam", status: ["approved", "pending"], deleted_at: null }),
    ])
    const perMonth = Number(config?.phep_nam_per_month ?? 1)
    const now = new Date()
    const q = vnQuarterOf(now)

    const profile = findEmployeeProfile(profiles, targetEmail)
    const chinhThuc = profile?.ngay_chinh_thuc ? new Date(profile.ngay_chinh_thuc).getTime() : null

    // Tháng được tính phép: từ đầu quý tới tháng hiện tại, và đã chính thức trước khi tháng đó kết thúc.
    let accrued = 0
    if (chinhThuc != null && chinhThuc <= now.getTime()) {
      for (let m = q.firstMonth; m <= q.currentMonth; m++) {
        const monthEnd = Date.UTC(q.year, m + 1, 1) - 7 * 3600_000
        if (chinhThuc < monthEnd) accrued += perMonth
      }
    }

    // Đơn của người này — cả email đăng nhập lẫn email ghi trong hồ sơ.
    const myEmails = new Set([targetEmail.toLowerCase(),
      ...[profile?.email_cong_ty, profile?.email_ca_nhan].filter(Boolean).map((x: string) => x.toLowerCase())])
    const daysInQuarter = (l: any) => {
      const s = Math.max(new Date(l.start_at).getTime(), q.start)
      const e = Math.min(new Date(l.end_at).getTime(), q.end)
      return e > s ? leaveWorkDays(new Date(s), new Date(e), config || {}) : 0
    }
    let used = 0, pending = 0
    for (const l of leaves) {
      if (!myEmails.has(String(l.requester_email).toLowerCase())) continue
      if (l.status === "approved") used += daysInQuarter(l)
      else pending += daysInQuarter(l)
    }
    const r2 = (n: number) => Math.round(n * 100) / 100

    res.json({
      year: q.year,
      quarter: q.quarter,
      user_email: targetEmail,
      accrued_days: accrued,
      used_days: r2(used),
      pending_days: r2(pending),
      remaining_days: r2(accrued - used),
      per_month: perMonth,
      // UI dùng để báo vì sao = 0: không tìm thấy hồ sơ / chưa qua thử việc.
      has_profile: !!profile,
      chinh_thuc: profile?.ngay_chinh_thuc ?? null,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
