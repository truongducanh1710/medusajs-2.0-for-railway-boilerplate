import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail, userHasPerm } from "../_lib"

export async function userHasOvertimeApprovePerm(req: MedusaRequest, email: string): Promise<boolean> {
  return userHasPerm(req, email, "page.overtime.approve")
}

function minutesOfDay(iso: string): number {
  const vn = new Date(new Date(iso).getTime() + 7 * 3600_000)
  return vn.getUTCHours() * 60 + vn.getUTCMinutes()
}
function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

// Tính lại OT tự động (source="auto") cho 1 ngày đã có đủ checkout, dựa trên log GPS —
// gọi mỗi khi có checkout mới (xem checkin/route.ts) để không cần cron riêng.
export async function recomputeOvertimeForDay(svc: any, userEmail: string, dayKey: string) {
  const [config] = await svc.listChamCongConfigs({ id: "default" })
  if (!config) return

  const logs = await svc.listChamCongLogs(
    { user_email: userEmail, day_key: dayKey, deleted_at: null },
    { order: { created_at: "ASC" } }
  )
  const lastOut = [...logs].reverse().find((l: any) => l.action === "out")
  if (!lastOut) return

  const isHalfDay = (config.half_day_saturdays || []).includes(dayKey)
  const shiftEnd = isHalfDay ? "12:00" : config.shift_end
  const outMin = minutesOfDay(lastOut.created_at)
  const shiftEndMin = hhmmToMinutes(shiftEnd)
  const otMin = Math.max(0, outMin - shiftEndMin)

  const [existing] = await svc.listOvertimeRequests({ user_email: userEmail, day_key: dayKey, deleted_at: null })

  if (otMin < (config.ot_min_threshold_min ?? 15)) {
    // Không đủ ngưỡng — nếu đã có bản ghi auto pending trước đó (VD checkout bị sửa sớm lại) thì xoá.
    if (existing && existing.source === "auto" && existing.status === "pending") {
      await svc.deleteOvertimeRequests(existing.id)
    }
    return
  }

  if (existing) {
    if (existing.status === "pending" && existing.source === "auto") {
      await svc.updateOvertimeRequests({ id: existing.id, duration_min: otMin })
    }
    // Đã approved/rejected hoặc manual thì không tự ý ghi đè.
    return
  }

  await svc.createOvertimeRequests({
    user_email: userEmail,
    day_key: dayKey,
    duration_min: otMin,
    source: "auto",
    status: "pending",
  })
}

// GET /admin/cham-cong/overtime?scope=mine|pending|approved&month=2026-07
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const scope = String((req.query as any).scope || "mine")
    const month = (req.query as any).month ? String((req.query as any).month) : null
    const svc = req.scope.resolve("mktTaskModule") as any

    const filter: any = { deleted_at: null }
    if (month) filter.day_key = { $gte: `${month}-01`, $lt: `${month}-32` }

    if (scope === "mine") {
      filter.user_email = email
    } else if (scope === "pending" || scope === "approved") {
      if (!(await userHasOvertimeApprovePerm(req, email))) {
        return res.status(403).json({ error: "Ban khong co quyen duyet OT" })
      }
      filter.status = scope === "pending" ? "pending" : { $in: ["approved", "rejected"] }
    } else {
      return res.status(400).json({ error: "scope khong hop le" })
    }

    const requests = await svc.listOvertimeRequests(filter, { order: { day_key: "DESC" } })
    res.json({ requests })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/cham-cong/overtime — HR/manager khai báo OT thủ công cho 1 nhân viên (source="manual")
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await userHasOvertimeApprovePerm(req, email))) {
      return res.status(403).json({ error: "Ban khong co quyen khai bao OT cho nguoi khac" })
    }

    const { user_email, day_key, duration_min, note } = req.body as any
    if (!user_email || !/^\d{4}-\d{2}-\d{2}$/.test(day_key || "") || typeof duration_min !== "number" || duration_min <= 0) {
      return res.status(400).json({ error: "Thieu hoac sai user_email/day_key/duration_min" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const [existing] = await svc.listOvertimeRequests({ user_email, day_key, deleted_at: null })
    if (existing) return res.status(400).json({ error: "Da co ban ghi OT cho ngay nay, sua truc tiep thay vi tao moi" })

    const request = await svc.createOvertimeRequests({
      user_email,
      day_key,
      duration_min: Math.round(duration_min),
      source: "manual",
      status: "pending",
      note: note ? String(note).slice(0, 500) : null,
    })
    res.json({ request })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
