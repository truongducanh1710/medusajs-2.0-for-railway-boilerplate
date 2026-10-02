import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { vnDayKey } from "../../mkt-chat/_presence"
import { getCurrentUserEmail } from "../_lib"
import { recomputeOvertimeForDay } from "../overtime/route"

/**
 * Khung giờ được phép chấm công hiện tại cho 1 người (giờ VN).
 *  - Từ checkin_cutoff (mặc định 21:00) tới hết ngày: khoá hẳn, không ngoại lệ.
 *  - Trước checkin_open (mặc định 08:00): chỉ mở nếu hôm nay có lịch tăng ca —
 *    overtime_request của người này cho hôm nay, trạng thái chưa bị từ chối. Đơn OT
 *    tạo tay chỉ quản lý tạo được (route overtime POST), nên đây đúng là "lịch đã xếp".
 * Kiểm tra ở server, không tin vào việc giao diện ẩn nút.
 */
async function checkinWindow(svc: any, email: string, today: string) {
  const [config] = await svc.listChamCongConfigs({ id: "default" })
  const open: string = config?.checkin_open || "08:00"
  const cutoff: string = config?.checkin_cutoff || "21:00"
  const mm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m }
  const vnNow = new Date(Date.now() + 7 * 3600_000)
  const nowMin = vnNow.getUTCHours() * 60 + vnNow.getUTCMinutes()

  if (nowMin >= mm(cutoff)) {
    return { allowed: false, open, cutoff, reason: `Đã quá ${cutoff}, hệ thống khoá chấm công hôm nay. Sáng mai từ ${open} mới chấm được.` }
  }
  if (nowMin < mm(open)) {
    const ot = await svc.listOvertimeRequests({ user_email: email, day_key: today, deleted_at: null })
    const coLich = ot.some((r: any) => r.status !== "rejected")
    if (!coLich) {
      return { allowed: false, open, cutoff, reason: `Chưa tới ${open}. Chỉ được chấm công sớm hơn khi có lịch tăng ca hôm nay — liên hệ quản lý để xếp lịch.` }
    }
    return { allowed: true, open, cutoff, reason: null, early_by_ot: true }
  }
  return { allowed: true, open, cutoff, reason: null }
}

// GET /admin/cham-cong/checkin — lịch sử chấm công hôm nay của người đang đăng nhập
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const today = vnDayKey()
    const logs = await svc.listChamCongLogs(
      { user_email: email, day_key: today, deleted_at: null },
      { order: { created_at: "ASC" } }
    )
    const window = await checkinWindow(svc, email, today)

    res.json({ logs, window })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/cham-cong/checkin — bấm chấm công vào/ra, kèm GPS
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const { action, lat, lng, accuracy_m, address } = req.body as any
    if (action !== "in" && action !== "out") {
      return res.status(400).json({ error: "action phải là 'in' hoặc 'out'" })
    }
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ error: "Bắt buộc phải có vị trí GPS để chấm công. Vui lòng cho phép truy cập vị trí." })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const today = vnDayKey()

    const window = await checkinWindow(svc, email, today)
    if (!window.allowed) {
      return res.status(400).json({ error: window.reason, window })
    }

    // Chống bấm trùng: lượt mới cách lượt gần nhất dưới 2 phút thì bỏ. Gặp 01/10/2026:
    // một người bấm vào–ra–vào trong 24 giây khi thử nút, ngày đó kết thúc ở trạng thái
    // "vào" và giờ ra bị mất. Không nhân viên nào thực sự vào rồi ra trong 2 phút.
    const DEDUP_MS = 2 * 60_000
    const [lastLog] = await svc.listChamCongLogs(
      { user_email: email, day_key: today, deleted_at: null },
      { order: { created_at: "DESC" }, take: 1 }
    )
    if (lastLog && Date.now() - new Date(lastLog.created_at).getTime() < DEDUP_MS) {
      const hhmm = new Date(new Date(lastLog.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 16)
      return res.status(400).json({
        error: `Bạn vừa chấm ${lastLog.action === "in" ? "vào" : "ra"} lúc ${hhmm}. Đợi 2 phút nếu cần chấm lại.`,
      })
    }

    const log = await svc.createChamCongLogs({
      user_email: email,
      action,
      lat,
      lng,
      accuracy_m: typeof accuracy_m === "number" ? accuracy_m : null,
      address: address ? String(address).slice(0, 255) : null,
      day_key: today,
    })

    if (action === "out") {
      await recomputeOvertimeForDay(svc, email, today).catch(() => {})
    }

    res.json({ log })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
