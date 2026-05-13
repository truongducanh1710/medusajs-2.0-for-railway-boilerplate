import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "../../../lib/constants"

const PANCAKE_STATUS_MAP: Record<number, { label: string; cls: string }> = {
  0: { label: "Chờ xử lý", cls: "bg-yellow-100 text-yellow-700" },
  1: { label: "Đã xác nhận", cls: "bg-blue-100 text-blue-700" },
  2: { label: "Đang đóng gói", cls: "bg-blue-100 text-blue-700" },
  3: { label: "Chờ giao", cls: "bg-orange-100 text-orange-700" },
  4: { label: "Đang giao", cls: "bg-blue-100 text-blue-600" },
  5: { label: "Hoàn thành", cls: "bg-green-100 text-green-700" },
  9: { label: "Đã gửi VC", cls: "bg-blue-100 text-blue-700" },
  11: { label: "Chờ hàng", cls: "bg-gray-100 text-gray-600" },
  7: { label: "Đã hủy", cls: "bg-red-100 text-red-700" },
  [-1]: { label: "Đã hủy", cls: "bg-red-100 text-red-700" },
  [-2]: { label: "Hoàn hàng", cls: "bg-purple-100 text-purple-700" },
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
        const info = PANCAKE_STATUS_MAP[status] ?? { label: `#${status}`, cls: "bg-gray-100 text-gray-600" }
        statuses[id] = { status, ...info }
      } catch {
        // timeout hoặc lỗi → bỏ qua
      }
    })
  )

  res.json({ statuses })
}
