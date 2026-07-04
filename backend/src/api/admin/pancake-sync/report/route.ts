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
          "shop_name",
        ],
        order: { pancake_created_at: "ASC" },
      }
    )

    // Doanh thu "COD" = SUM(cod_amount) của TẤT CẢ đơn mọi trạng thái, cho cả VN và MY —
    // khớp con số COD Pancake POS. cod_amount là tiền cần thu (sau giảm giá/phí sàn), khác với
    // `total` (giá gốc trước khuyến mãi). Trước đây VN dùng SUM(total) mọi đơn khiến doanh thu
    // đội lên (vd tháng 6: total=3.18 tỷ vs cod_amount=2.59 tỷ) — đã thống nhất dùng cod_amount.
    const revenueOf = (o: any): number => Number(o.cod_amount ?? 0)

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
    // MY: gắn thêm shop_name của mỗi SP (mỗi SP chỉ bán ở 1 gian hàng — verify thực tế 35/35 SP).
    const productMap = new Map<string, { qty: number; revenue: number; shop_name?: string }>()
    for (const o of allOrders) {
      const items: any[] = Array.isArray(o.items) ? o.items : []
      for (const item of items) {
        const name = item.name || "—"
        const qty = item.qty || 1
        const price = item.price || 0
        const lineRevenue = price * qty
        const entry = productMap.get(name) || { qty: 0, revenue: 0, ...(mkt === "MY" ? { shop_name: o.shop_name || "" } : {}) }
        entry.qty += qty
        entry.revenue += lineRevenue
        if (mkt === "MY" && !entry.shop_name && o.shop_name) entry.shop_name = o.shop_name
        productMap.set(name, entry)
      }
    }
    const byProduct = Array.from(productMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50) // top 50 (MY cần đủ để phủ mọi shop)

    // --- By shop (chỉ MY: nhiều gian hàng TikTok con phân biệt qua shop_name) ---
    // Tách doanh số theo từng gian hàng + theo ngày để thấy shop nào đang tốt.
    let byShop: any[] | undefined
    let byShopDay: any | undefined
    if (mkt === "MY") {
      const shopMap = new Map<string, { orders: number; revenue: number }>()
      // shopDay: shop_name -> { date -> { orders, revenue } }
      const shopDayMap = new Map<string, Map<string, { orders: number; revenue: number }>>()
      const daySet = new Set<string>()
      for (const o of allOrders) {
        const shop = o.shop_name || "(không rõ)"
        const rev = revenueOf(o)
        const dateStr = o.pancake_created_at
          ? new Date(o.pancake_created_at).toISOString().slice(0, 10)
          : "unknown"
        daySet.add(dateStr)

        const s = shopMap.get(shop) || { orders: 0, revenue: 0 }
        s.orders++; s.revenue += rev
        shopMap.set(shop, s)

        if (!shopDayMap.has(shop)) shopDayMap.set(shop, new Map())
        const dm = shopDayMap.get(shop)!
        const d = dm.get(dateStr) || { orders: 0, revenue: 0 }
        d.orders++; d.revenue += rev
        dm.set(dateStr, d)
      }
      byShop = Array.from(shopMap.entries())
        .map(([shop_name, data]) => ({ shop_name, ...data }))
        .sort((a, b) => b.revenue - a.revenue)

      const days = Array.from(daySet).filter(d => d !== "unknown").sort()
      byShopDay = {
        days,
        shops: byShop.map(s => ({
          shop_name: s.shop_name,
          total_orders: s.orders,
          total_revenue: s.revenue,
          per_day: days.map(d => {
            const cell = shopDayMap.get(s.shop_name)?.get(d)
            return { date: d, orders: cell?.orders ?? 0, revenue: cell?.revenue ?? 0 }
          }),
        })),
      }
    }

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
      ...(byShop ? { by_shop: byShop, by_shop_day: byShopDay } : {}),
    })
  } catch (err: any) {
    console.error("[PancakeSync Report API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
