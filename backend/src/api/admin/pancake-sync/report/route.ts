import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MYR_TO_VND_RATE } from "../../../../lib/constants"

/**
 * GET /admin/pancake-sync/report?from=...&to=...
 *
 * Aggregates pancake_order data for reporting:
 * - total_orders, total_revenue, success_rate, return_rate
 * - breakdown by source
 * - breakdown by day
 * - top products
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to, market } = req.query as Record<string, string | undefined>

    if (!from || !to) {
      return res.status(400).json({ error: "Missing required query params: from, to (ISO date strings)" })
    }

    const fromDate = new Date(from)
    const toDate = new Date(to)

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" })
    }

    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const mkt = market || "VN"

    // Fetch all orders in range (without raw column for performance)
    const allOrders = await syncService.listPancakeOrders(
      {
        pancake_created_at: {
          $gte: fromDate,
          $lte: toDate,
        },
        market: mkt,
      },
      {
        take: 10000, // reasonable upper bound for reporting
        select: [
          "id",
          "source",
          "status",
          "total",
          "cod_amount",
          "items",
          "pancake_created_at",
          "currency",
        ],
        order: { pancake_created_at: "ASC" },
      }
    )

    // Doanh thu "COD" = tiền thực thu. VN giữ nguyên hành vi cũ (sum total, mọi trạng thái —
    // không đổi để tránh xáo trộn số liệu VN đang dùng hằng ngày). MY dùng cod_amount (tiền
    // thực thu sau giảm giá/phí sàn) và chỉ tính đơn giao thành công (status=3), vì `total`
    // là giá gốc trước khuyến mãi — verify qua đơn thật: total=5800 (58 RM giá gốc) nhưng
    // cod_amount=1246 (12.46 RM tiền thực thu, khớp Pancake "Tiền cần thu").
    const revenueOf = (o: any): number =>
      mkt === "MY" ? (o.status === 3 ? Number(o.cod_amount ?? 0) : 0) : Number(o.total ?? 0)

    // --- Totals ---
    const totalOrders = allOrders.length
    const totalRevenue = allOrders.reduce((sum: number, o: any) => sum + revenueOf(o), 0)

    // Mapping đúng theo Pancake (verify bằng status_name từ API):
    //   3 = giao thành công (delivered) — revenue thực thu
    //   4 = đang hoàn về, 5 = đã hoàn về kho, -2 = hoàn manual
    //   6 = canceled (hủy bởi sale), 7 = deleted, -1 = hủy legacy
    const successCount = allOrders.filter((o: any) => o.status === 3).length
    const returnCount = allOrders.filter((o: any) =>
      o.status === 4 || o.status === 5 || o.status === -2
    ).length
    const cancelCount = allOrders.filter((o: any) =>
      o.status === 6 || o.status === 7 || o.status === -1
    ).length

    const successRate = totalOrders > 0 ? Math.round((successCount / totalOrders) * 100) : 0
    const returnRate = totalOrders > 0 ? Math.round((returnCount / totalOrders) * 100) : 0

    // --- By source ---
    const sourceMap = new Map<string, { orders: number; revenue: number }>()
    for (const o of allOrders) {
      const src = o.source || "unknown"
      const entry = sourceMap.get(src) || { orders: 0, revenue: 0 }
      entry.orders++
      entry.revenue += revenueOf(o)
      sourceMap.set(src, entry)
    }
    const bySource = Array.from(sourceMap.entries())
      .map(([source, data]) => ({ source, ...data }))
      .sort((a, b) => b.revenue - a.revenue)

    // --- By day ---
    const dayMap = new Map<string, { orders: number; revenue: number }>()
    for (const o of allOrders) {
      const dateStr = o.pancake_created_at
        ? new Date(o.pancake_created_at).toISOString().slice(0, 10)
        : "unknown"
      const entry = dayMap.get(dateStr) || { orders: 0, revenue: 0 }
      entry.orders++
      entry.revenue += revenueOf(o)
      dayMap.set(dateStr, entry)
    }
    const byDay = Array.from(dayMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // --- By product ---
    const productMap = new Map<string, { qty: number; revenue: number }>()
    for (const o of allOrders) {
      const items: any[] = Array.isArray(o.items) ? o.items : []
      for (const item of items) {
        const name = item.name || "—"
        const qty = item.qty || 1
        const price = item.price || 0
        const lineRevenue = price * qty
        const entry = productMap.get(name) || { qty: 0, revenue: 0 }
        entry.qty += qty
        entry.revenue += lineRevenue
        productMap.set(name, entry)
      }
    }
    const byProduct = Array.from(productMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20) // top 20

    return res.json({
      from,
      to,
      market: mkt,
      currency: allOrders[0]?.currency ?? (mkt === "MY" ? "MYR" : "VND"),
      ...(mkt === "MY" ? { myr_to_vnd_rate: MYR_TO_VND_RATE } : {}),
      total_orders: totalOrders,
      total_revenue: totalRevenue,
      success_rate: successRate,
      return_rate: returnRate,
      success_count: successCount,
      return_count: returnCount,
      cancel_count: cancelCount,
      by_source: bySource,
      by_day: byDay,
      by_product: byProduct,
    })
  } catch (err: any) {
    console.error("[PancakeSync Report API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
