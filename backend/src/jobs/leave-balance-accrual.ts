import { MedusaContainer } from "@medusajs/framework"

// Chạy 1 lần/ngày (idempotent qua last_accrual_month) — cộng phép năm cho nhân viên đang
// active, đã qua ngày chính thức (ngay_chinh_thuc), theo config.phep_nam_per_month, trần
// config.phep_nam_max_per_year. Chỉ cộng 1 lần mỗi tháng dương lịch dù job chạy nhiều lần trong tháng.
export default async function leaveBalanceAccrual(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const svc = container.resolve("mktTaskModule") as any

  try {
    const [config] = await svc.listChamCongConfigs({ id: "default" })
    const perMonth = config?.phep_nam_per_month ?? 1
    const maxPerYear = config?.phep_nam_max_per_year ?? 12
    if (perMonth <= 0) return

    const now = new Date()
    const vn = new Date(now.getTime() + 7 * 3600_000)
    const year = vn.getUTCFullYear()
    const monthKey = `${year}-${String(vn.getUTCMonth() + 1).padStart(2, "0")}`

    const employees = await svc.listEmployeeProfiles({ trang_thai: "active", deleted_at: null })
    let accruedCount = 0

    for (const emp of employees) {
      // Chưa qua thử việc (chưa có ngày chính thức, hoặc ngày chính thức ở tương lai) thì chưa tích phép.
      if (!emp.ngay_chinh_thuc || new Date(emp.ngay_chinh_thuc) > now) continue
      const targetEmail = emp.email_cong_ty || emp.email_ca_nhan
      if (!targetEmail) continue

      const [existing] = await svc.listLeaveBalances({ user_email: targetEmail, year, deleted_at: null })
      if (existing?.last_accrual_month === monthKey) continue // đã cộng tháng này rồi

      const currentAccrued = existing ? Number(existing.accrued_days) : 0
      const nextAccrued = Math.min(maxPerYear, currentAccrued + perMonth)

      if (existing) {
        await svc.updateLeaveBalances({ id: existing.id, accrued_days: nextAccrued, last_accrual_month: monthKey })
      } else {
        await svc.createLeaveBalances({
          user_email: targetEmail, year, accrued_days: nextAccrued, used_days: 0, last_accrual_month: monthKey,
        })
      }
      accruedCount++
    }

    logger?.info?.(`[LeaveBalanceAccrual] Accrued phép tháng ${monthKey} cho ${accruedCount} nhân viên`)
  } catch (e: any) {
    logger?.error?.(`[LeaveBalanceAccrual] Error: ${e.message}`)
  }
}

export const config = {
  name: "leave-balance-accrual",
  schedule: "0 1 * * *", // 01:00 sáng mỗi ngày (giờ server UTC ~ 08:00 VN)
}
