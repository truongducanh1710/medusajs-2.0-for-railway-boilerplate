import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "../../../lib/constants"

// Mapping đúng theo Pancake (verify bằng partner_status thật)
const STATUS_VI: Record<number, string> = {
  0: "Chờ xử lý",
  1: "Sale đã chốt",
  2: "Đang giao",
  3: "Giao thành công",
  4: "Đang hoàn về",
  5: "Đã hoàn về kho",
  6: "Đã gửi VC",
  7: "Đã xóa",
  9: "Chờ VTP lấy",
  11: "Chờ hàng",
  "-1": "Đã hủy",
  "-2": "Hoàn hàng",
} as any

function getStatusLabel(status: number): string {
  return STATUS_VI[status] ?? STATUS_VI[String(status)] ?? `Trạng thái ${status}`
}

function getStatusCls(status: number): string {
  if (status === 3) return "bg-green-100 text-green-700"
  if (status === 7 || status === -1 || status === 5) return "bg-red-100 text-red-700"
  if (status === -2 || status === 4) return "bg-purple-100 text-purple-700"
  if (status === 2 || status === 6 || status === 9) return "bg-blue-100 text-blue-700"
  if (status === 0 || status === 11) return "bg-yellow-100 text-yellow-700"
  if (status === 1) return "bg-orange-100 text-orange-700"
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
        const label = getStatusLabel(status)
        const cls = getStatusCls(status)
        statuses[id] = { status, label, cls }
      } catch {
        // timeout hoặc lỗi → bỏ qua
      }
    })
  )

  res.json({ statuses })
}
