import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { pos } from "../../../../../lib/sale-queue"

const cache = new Map<string, { at: number; data: any }>()
const TTL = 6 * 3600_000

/**
 * GET /admin/pancake-sync/call-board/reputation?phone=0352601766
 * Uy tín SĐT trên TOÀN mạng Pancake (thanh xanh/đỏ "Đơn thành công / Đơn hoàn" của POS).
 * Endpoint orders/bad_report_info không có trong tài liệu API — tìm từ JS của POS
 * (21/10/2026). Lỗi thì trả rỗng để thẻ đơn chỉ ẩn thanh này.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const phone = String((req.query as any).phone ?? "").replace(/\D/g, "")
  if (phone.length < 9) return res.status(400).json({ error: "SĐT không hợp lệ" })
  const hit = cache.get(phone)
  if (hit && Date.now() - hit.at < TTL) return res.json(hit.data)
  try {
    const r = await pos("GET", `/orders/bad_report_info?phone_number=${phone}`)
    let success = 0, fail = 0, warning = 0
    for (const v of Object.values<any>(r?.data?.reports_by_phone ?? {})) {
      success += v.order_success || 0
      fail += v.order_fail || 0
      warning += v.warning || 0
    }
    const total = success + fail
    const data = {
      available: true,
      success,
      fail,
      warning,
      return_rate: total ? Math.round((fail / total) * 100) : null,
      flagged: (r?.data?.warning_phone_number ?? []).length > 0,
    }
    cache.set(phone, { at: Date.now(), data })
    res.json(data)
  } catch {
    res.json({ available: false })
  }
}
