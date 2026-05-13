import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "../../../lib/constants"

// CSS class theo nhóm trạng thái — dùng status_name từ Pancake API
function getStatusCls(statusName: string, status: number): string {
  if (status === 5) return "bg-green-100 text-green-700"                         // Hoàn thành
  if (status === 7 || status === -1) return "bg-red-100 text-red-700"            // Đã hủy
  if (status === -2) return "bg-purple-100 text-purple-700"                      // Hoàn hàng
  if (status === 2 || status === 4 || status === 9) return "bg-blue-100 text-blue-700" // Đang giao / Đã gửi VC
  if (status === 0 || status === 11) return "bg-yellow-100 text-yellow-700"      // Chờ xử lý / Chờ hàng
  return "bg-gray-100 text-gray-600"
}

// GET /admin/pancake-status?ids=id1,id2,...
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!PANCAKE_API_KEY || !PANCAKE_SHOP_ID) {
    res.json({ statuses: {} })
    return
  }

  const idsParam = req.query.ids as string | undefined
  if (!idsParam) {
    res.json({ statuses: {} })
    return
  }

  const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 50)
  const statuses: Record<string, { status: number; label: string; cls: string }> = {}

  await Promise.all(
    ids.map(async (id) => {
      try {
        const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/orders/${id}?api_key=${PANCAKE_API_KEY}`
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const r = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout))
        if (!r.ok) return
        const data = await r.json()
        const order = data?.order ?? data?.data ?? data
        const status: number = order?.status ?? order?.order_status ?? 0
        // Đọc tên từ API Pancake trực tiếp — không hardcode
        const label: string = order?.status_name || `status_${status}`
        const cls = getStatusCls(label, status)
        statuses[id] = { status, label, cls }
      } catch {
        // timeout hoặc lỗi → bỏ qua
      }
    })
  )

  res.json({ statuses })
}
