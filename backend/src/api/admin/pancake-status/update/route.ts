import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "../../../../lib/constants"

/**
 * POST /admin/pancake-status/update — đẩy trạng thái đơn lên Pancake POS.
 *
 * Dùng khi hàng hoàn đã thực sự về kho (có video "nhập hàng hoàn" trên Dohana) nhưng POS
 * vẫn để "Đang hoàn về" (status 4). Hiện có ~2.500 đơn kẹt ở trạng thái này, làm sai
 * lệch báo cáo và tồn kho.
 *
 * ĐẨY LÊN POS chứ không sửa thẳng DB: POS là nguồn sự thật, sửa DB sẽ bị ghi đè ở lần
 * sync sau. Sau khi POS đổi, webhook Pancake tự bắn về cập nhật DB.
 *
 * Body: { orders: [{ pos_id, status }], dry_run?: boolean }
 *
 * MẶC ĐỊNH LÀ DRY RUN. Phải truyền dry_run:false mới thật sự ghi — đây là thao tác khó
 * rút lại trên hệ thống thật, nên không để lỡ tay.
 */

const STATUS_VI: Record<number, string> = {
  0: "Chờ xử lý", 1: "Sale đã chốt", 2: "Đang giao", 3: "Giao thành công",
  4: "Đang hoàn về", 5: "Đã hoàn về kho", 6: "Đã hủy", 7: "Đã xóa", 11: "Chờ hàng",
}

// Chỉ cho phép các chuyển đổi có lý do nghiệp vụ rõ ràng. Chặn mọi thứ khác để một lỗi
// logic không thể biến đơn thành "giao thành công" hay "đã huỷ" hàng loạt.
const CHUYEN_DOI_CHO_PHEP: Record<number, number[]> = {
  4: [5], // Đang hoàn về → Đã hoàn về kho (có bằng chứng hàng đã nhập lại)
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!PANCAKE_API_KEY || !PANCAKE_SHOP_ID) {
    res.status(500).json({ error: "Chưa cấu hình PANCAKE_API_KEY / PANCAKE_SHOP_ID" })
    return
  }

  const body = (req.body ?? {}) as any
  const dryRun = body.dry_run !== false
  const list = Array.isArray(body.orders) ? body.orders.slice(0, 200) : []
  if (!list.length) {
    res.status(400).json({ error: "Thiếu danh sách orders" })
    return
  }

  const ketQua: any[] = []

  for (const it of list) {
    const posId = String(it?.pos_id ?? "").trim()
    const statusMoi = Number(it?.status)
    if (!posId || !Number.isFinite(statusMoi)) {
      ketQua.push({ pos_id: posId, ok: false, error: "Thiếu pos_id hoặc status" })
      continue
    }

    try {
      // Đọc trạng thái hiện tại trước: không dựa vào DB vì DB có thể cũ, và cần biết
      // chuyển đổi này có hợp lệ không.
      const urlGet = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/orders/${posId}?api_key=${PANCAKE_API_KEY}`
      const rGet = await fetch(urlGet)
      if (!rGet.ok) {
        ketQua.push({ pos_id: posId, ok: false, error: `Không đọc được đơn (HTTP ${rGet.status})` })
        continue
      }
      const dGet: any = await rGet.json()
      const order = dGet?.order ?? dGet?.data ?? dGet
      const statusCu = Number(order?.status)

      if (statusCu === statusMoi) {
        ketQua.push({
          pos_id: posId, ok: true, skipped: true,
          message: `Đã là "${STATUS_VI[statusMoi] ?? statusMoi}" rồi, bỏ qua`,
        })
        continue
      }

      const chophep = CHUYEN_DOI_CHO_PHEP[statusCu] ?? []
      if (!chophep.includes(statusMoi)) {
        ketQua.push({
          pos_id: posId, ok: false,
          error: `Không cho phép chuyển ${statusCu} (${STATUS_VI[statusCu] ?? "?"}) ` +
                 `→ ${statusMoi} (${STATUS_VI[statusMoi] ?? "?"})`,
        })
        continue
      }

      if (dryRun) {
        ketQua.push({
          pos_id: posId, ok: true, dry_run: true,
          status_cu: statusCu, status_moi: statusMoi,
          message: `SẼ đổi "${STATUS_VI[statusCu]}" → "${STATUS_VI[statusMoi]}"`,
        })
        continue
      }

      const urlPut = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/orders/${posId}?api_key=${PANCAKE_API_KEY}`
      const rPut = await fetch(urlPut, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: statusMoi }),
      })
      const text = await rPut.text()
      if (!rPut.ok) {
        ketQua.push({ pos_id: posId, ok: false, error: `HTTP ${rPut.status}: ${text.slice(0, 200)}` })
        continue
      }

      ketQua.push({
        pos_id: posId, ok: true, status_cu: statusCu, status_moi: statusMoi,
        message: `Đã đổi "${STATUS_VI[statusCu]}" → "${STATUS_VI[statusMoi]}"`,
        response: text.slice(0, 300),
      })
    } catch (err: any) {
      ketQua.push({ pos_id: posId, ok: false, error: err.message })
    }
  }

  res.json({
    dry_run: dryRun,
    tong: ketQua.length,
    thanh_cong: ketQua.filter(r => r.ok && !r.skipped).length,
    bo_qua: ketQua.filter(r => r.skipped).length,
    loi: ketQua.filter(r => !r.ok).length,
    ket_qua: ketQua,
  })
}
