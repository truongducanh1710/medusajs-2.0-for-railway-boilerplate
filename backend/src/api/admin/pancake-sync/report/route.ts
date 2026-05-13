import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

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
    const { from, to } = req.query as Record<string, string | undefined>

    if (!from || !to) {
      return res.status(400).json({ error: "Missing required query params: from, to (ISO date strings)" })
    }

    const fromDate = new Date(from)
    const toDate = new Date(to)

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" })
    }

    const syncService = req.scope.resolve("pancakeSyncModule") as any

    // Fetch all orders in range (without raw column for performance)
    const allOrders = await syncService.listPancakeOrders(
      {
        pancake_created_at: {
          $gte: fromDate,
          $lte: toDate,
        },
      },
      {
        take: 10000, // reasonable upper bound for reporting
        select: [
          "id",
          "source",
          "status",
          "total",
          "items",
          "pancake_created_at",
        ],
        order: { pancake_created_at: "ASC" },
      }
    )

    // --- Totals ---
    const totalOrders = allOrders.length
    const totalRevenue = allOrders.reduce((sum: number, o: any) => sum + Number(o.total ?? 0), 0)

    const successCount = allOrders.filter((o: any) => o.status === 5).length
    const returnCount = allOrders.filter((o: any) => o.status === -2).length
    const cancelCount = allOrders.filter((o: any) => o.status === 7 || o.status === -1).length

    const successRate = totalOrders > 0 ? Math.round((successCount / totalOrders) * 100) : 0
    const returnRate = totalOrders > 0 ? Math.round((returnCount / totalOrders) * 100) : 0

    // --- By source ---
    const sourceMap = new Map<string, { orders: number; revenue: number }>()
    for (const o of allOrders) {
      const src = o.source || "unknown"
      const entry = sourceMap.get(src) || { orders: 0, revenue: 0 }
      entry.orders++
      entry.revenue += Number(o.total ?? 0)
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
      entry.revenue += Number(o.total ?? 0)
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
