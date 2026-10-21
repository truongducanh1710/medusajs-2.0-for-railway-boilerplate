import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getDailyList, vnDay } from "../../../../lib/cskh-queue"

/**
 * GET /admin/cskh/daily?date=YYYY-MM-DD (mặc định hôm nay, giờ VN)
 * Danh sách gọi CSKH của 1 ngày: đơn nào cần gọi, đã gọi chưa, kết quả (note) là gì.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = String((req.query as any).date ?? "")
    const day = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : vnDay(Date.now())
    res.json(await getDailyList(day))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
