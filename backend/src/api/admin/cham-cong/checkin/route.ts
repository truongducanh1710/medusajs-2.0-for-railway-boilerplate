import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { vnDayKey } from "../../mkt-chat/_presence"
import { getCurrentUserEmail } from "../_lib"

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

    res.json({ logs })
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

    const log = await svc.createChamCongLogs({
      user_email: email,
      action,
      lat,
      lng,
      accuracy_m: typeof accuracy_m === "number" ? accuracy_m : null,
      address: address ? String(address).slice(0, 255) : null,
      day_key: today,
    })

    res.json({ log })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
