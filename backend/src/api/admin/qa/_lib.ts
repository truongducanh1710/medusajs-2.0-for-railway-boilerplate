import { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

// ISO week key "2026-W29" từ 1 Date (theo giờ VN).
export function isoWeekKey(d: Date): string {
  const vn = new Date(d.getTime() + 7 * 3600_000)
  const date = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

// month_key "2026-07" suy ra từ tuần: dùng thứ Năm của tuần làm mốc tháng (ổn định, không lệch đầu/cuối tháng).
export function monthKeyOfWeek(weekKey: string): string {
  const [y, w] = weekKey.split("-W").map(Number)
  const firstThursday = new Date(Date.UTC(y, 0, 4))
  const thursday = new Date(firstThursday.getTime() + (w - 1) * 7 * 86400_000)
  return `${thursday.getUTCFullYear()}-${String(thursday.getUTCMonth() + 1).padStart(2, "0")}`
}

// Danh sách nhân sự chọn được để chấm QA — lấy từ tài khoản user admin.
export async function listStaff(req: MedusaRequest): Promise<{ email: string; name: string; team: string; role: string }[]> {
  const userModule = req.scope.resolve(Modules.USER)
  const users = await userModule.listUsers({}, { select: ["email", "first_name", "last_name", "metadata"] })
  return users.map((u: any) => ({
    email: u.email,
    name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
    team: u.metadata?.team || "",
    role: u.metadata?.role || "",
  }))
}
