import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getReputation } from "../../../../../lib/sale-queue"

/**
 * GET /admin/pancake-sync/call-board/reputation?phone=0352601766
 * Uy tín SĐT trên TOÀN mạng Pancake (thanh xanh/đỏ "Đơn thành công / Đơn hoàn" của POS).
 * Cache dùng chung với hàng đợi (xếp ưu tiên) — xem getReputation.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const phone = String((req.query as any).phone ?? "").replace(/\D/g, "")
  if (phone.length < 9) return res.status(400).json({ error: "SĐT không hợp lệ" })
  res.json(await getReputation(phone))
}
