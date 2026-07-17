import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail, userHasPerm } from "../../_lib"

async function getConfig(svc: any) {
  const [config] = await svc.listChamCongConfigs({ id: "default" })
  if (config) return config
  return svc.createChamCongConfigs({
    id: "default", shift_start: "08:30", shift_end: "17:30",
    work_days: [1, 2, 3, 4, 5, 6], late_grace_min: 5, half_day_saturdays: [],
  })
}

// GET /admin/cham-cong/checkin/config — mọi nhân viên đọc giờ ca chuẩn để vẽ lịch
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = req.scope.resolve("mktTaskModule") as any
    const config = await getConfig(svc)
    res.json({ config })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// PATCH /admin/cham-cong/checkin/config — chỉ ai có page.cham-cong.view (manager) được sửa
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await userHasPerm(req, email, "page.cham-cong.view"))) {
      return res.status(403).json({ error: "Ban khong co quyen sua cau hinh cham cong" })
    }

    const { shift_start, shift_end, work_days, late_grace_min, half_day_saturdays } = req.body as any
    if (shift_start && !/^\d{2}:\d{2}$/.test(shift_start)) {
      return res.status(400).json({ error: "shift_start phai dang HH:mm" })
    }
    if (shift_end && !/^\d{2}:\d{2}$/.test(shift_end)) {
      return res.status(400).json({ error: "shift_end phai dang HH:mm" })
    }
    if (work_days && (!Array.isArray(work_days) || work_days.some((d: any) => typeof d !== "number" || d < 0 || d > 6))) {
      return res.status(400).json({ error: "work_days phai la mang so 0-6" })
    }
    if (half_day_saturdays && (!Array.isArray(half_day_saturdays) || half_day_saturdays.some((d: any) => typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)))) {
      return res.status(400).json({ error: "half_day_saturdays phai la mang ngay dang YYYY-MM-DD" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    await getConfig(svc)

    const update: any = { id: "default" }
    if (shift_start) update.shift_start = shift_start
    if (shift_end) update.shift_end = shift_end
    if (work_days) update.work_days = work_days
    if (typeof late_grace_min === "number") update.late_grace_min = late_grace_min
    if (half_day_saturdays) update.half_day_saturdays = [...new Set(half_day_saturdays)].sort()

    const config = await svc.updateChamCongConfigs(update)
    res.json({ config })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
