import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/orders/facets
 * Trả về danh sách distinct value để render dropdown filter:
 *   { sales: [], marketers: [], provinces: [], statuses: [{value, label, count}] }
 *
 * Strategy: lấy mẫu 5000 đơn mới nhất → distinct trên các trường text.
 * Đủ tốt cho UX (sale/marketer mới sẽ xuất hiện sau khi có đơn).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const syncService = req.scope.resolve("pancakeSyncModule") as any

    const orders = await syncService.listPancakeOrders(
      {},
      {
        take: 5000,
        select: ["sale_name", "marketer_name", "province", "status", "status_name"],
        order: { pancake_created_at: "DESC" },
      }
    )

    const sales = new Set<string>()
    const marketers = new Set<string>()
    const provinces = new Set<string>()
    const statusMap = new Map<number, { value: number; label: string; count: number }>()

    for (const o of orders) {
      if (o.sale_name)      sales.add(o.sale_name)
      if (o.marketer_name)  marketers.add(o.marketer_name)
      if (o.province)       provinces.add(o.province)
      if (typeof o.status === "number") {
        const existing = statusMap.get(o.status)
        if (existing) existing.count++
        else statusMap.set(o.status, {
          value: o.status,
          label: o.status_name || `Trạng thái ${o.status}`,
          count: 1,
        })
      }
    }

    return res.json({
      sales:     Array.from(sales).sort((a, b) => a.localeCompare(b, "vi")),
      marketers: Array.from(marketers).sort((a, b) => a.localeCompare(b, "vi")),
      provinces: Array.from(provinces).sort((a, b) => a.localeCompare(b, "vi")),
      statuses:  Array.from(statusMap.values()).sort((a, b) => a.value - b.value),
    })
  } catch (err: any) {
    console.error("[PancakeSync Facets API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
