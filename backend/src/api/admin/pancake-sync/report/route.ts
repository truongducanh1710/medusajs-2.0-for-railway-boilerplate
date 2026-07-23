import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMyrToVndRate } from "../../../../lib/db"

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
    const { from, to, market, source_group } = req.query as Record<string, string | undefined>

    if (!from || !to) {
      return res.status(400).json({ error: "Missing required query params: from, to (ISO date strings)" })
    }

    // source_group: "all" (mặc định, mọi đơn Pancake — bức tranh toàn DN) hoặc "core"
    // (chỉ đơn khớp các báo cáo LNG/NV MKT/Sale: loại sàn TMĐT + đơn nháp/trùng/xóa).
    // Cho phép user đối chiếu Tổng quan với LNG khi cần.
    const coreOnly = source_group === "core"
    const CORE_SOURCES = new Set(["manual", "facebook", "medusa", "unknown", "webcake"])
    // Đơn LOẠI khỏi "core" (khớp excludeCond của marketer-lng):
    //   - đã xóa (7)
    //   - đơn nháp chưa xác nhận: tag "Đơn nháp" ở status 0/11
    //   - đơn nháp/trùng đã huỷ: tag "Đơn nháp"/"Đơn trùng" ở status 6/-1
    const hasTag = (o: any, name: string): boolean =>
      Array.isArray(o.tags) && o.tags.some((t: any) => String(t?.name ?? "") === name)
    const isExcludedCore = (o: any): boolean => {
      if (o.status === 7) return true
      const nhap = hasTag(o, "Đơn nháp")
      const trung = hasTag(o, "Đơn trùng")
      if (nhap && (o.status === 0 || o.status === 11)) return true
      if ((o.status === 6 || o.status === -1) && (nhap || trung)) return true
      return false
    }
    const keepOrder = (o: any): boolean =>
      !coreOnly || (CORE_SOURCES.has(o.source) && !isExcludedCore(o))

    const fromDate = new Date(from)
    const toDate = new Date(to)

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" })
    }

    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const mkt = market || "VN"

    // Kỳ liền trước cùng độ dài để tính tăng/giảm (Δ). Dời lùi đúng số ngày của kỳ hiện tại:
    // prevTo = fromDate (loại trừ) , prevFrom = fromDate - (toDate - fromDate). Vd 01→31/07 (31 ngày)
    // → so với 01→30/06. Chỉ dùng cho KPI tổng + by_source (không cần cho by_shop/by_platform).
    const rangeMs = toDate.getTime() - fromDate.getTime()
    const prevFromDate = new Date(fromDate.getTime() - rangeMs)
    const prevToDate = new Date(fromDate.getTime())

    // Group theo ngày ĐỊA PHƯƠNG (VN=UTC+7, MY=UTC+8), không phải ngày UTC — nếu không, đơn tạo
    // vào ~7-8 tiếng đầu ngày giờ địa phương bị gán nhầm sang ngày hôm trước trong by_day/by_shop_day.
    const TZ_OFFSET_HOURS = mkt === "MY" ? 8 : 7
    const localDateStr = (d: Date): string =>
      new Date(d.getTime() + TZ_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10)

    // Fetch all orders in range (without raw column for performance)
    const allOrdersRaw = await syncService.listPancakeOrders(
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
          "tags",
          "pancake_created_at",
          "currency",
          "shop_name",
        ],
        order: { pancake_created_at: "ASC" },
      }
    )
    const allOrders = allOrdersRaw.filter(keepOrder)

    // Kỳ liền trước: chỉ cần source + status + cod_amount + tags để tính totals + bySource (Δ).
    const prevOrdersRaw = await syncService.listPancakeOrders(
      {
        pancake_created_at: { $gte: prevFromDate, $lt: prevToDate },
        market: mkt,
      },
      {
        take: 10000,
        select: ["id", "source", "status", "cod_amount", "tags"],
      }
    )
    const prevOrders = prevOrdersRaw.filter(keepOrder)

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
    // Doanh thu THỰC THU = COD của riêng đơn giao thành công (status=3). Dùng cho AOV để tử số
    // và mẫu số cùng tập đơn — total_revenue (mọi trạng thái) chia success_count sẽ thổi phồng AOV.
    const successRevenue = allOrders
      .filter((o: any) => o.status === 3)
      .reduce((sum: number, o: any) => sum + revenueOf(o), 0)
    const returnCount = allOrders.filter((o: any) =>
      o.status === 4 || o.status === 5 || o.status === -2
    ).length
    const isCancelled = (o: any): boolean => o.status === 6 || o.status === 7 || o.status === -1
    const cancelCount = allOrders.filter(isCancelled).length

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
    // --- Kỳ trước: totals + revenue theo source, để tính Δ tăng/giảm ---
    let prevTotalRevenue = 0
    let prevSuccessCount = 0
    const prevSourceRev = new Map<string, number>()
    for (const o of prevOrders) {
      const rev = revenueOf(o)
      prevTotalRevenue += rev
      if (o.status === 3) prevSuccessCount++
      const src = o.source || "unknown"
      prevSourceRev.set(src, (prevSourceRev.get(src) || 0) + rev)
    }

    const bySource = Array.from(sourceMap.entries())
      .map(([source, data]) => ({ source, ...data, prev_revenue: prevSourceRev.get(source) || 0 }))
      .sort((a, b) => b.revenue - a.revenue)

    // --- By day ---
    const dayMap = new Map<string, { orders: number; revenue: number }>()
    for (const o of allOrders) {
      const dateStr = o.pancake_created_at
        ? localDateStr(new Date(o.pancake_created_at))
        : "unknown"
      const entry = dayMap.get(dateStr) || { orders: 0, revenue: 0 }
      entry.orders++
      entry.revenue += revenueOf(o)
      dayMap.set(dateStr, entry)
    }
    const byDay = Array.from(dayMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // --- By source + day (để vẽ biểu đồ xu hướng doanh thu từng nguồn theo thời gian) ---
    // Cùng cấu trúc với by_platform_day (MY) nhưng áp dụng chung cho mọi market, gom theo
    // `source` thô (manual/facebook/tiktok/shopee/website/...) khớp nhãn "Theo nguồn" trên UI.
    const sourceDayMap = new Map<string, Map<string, { orders: number; revenue: number }>>()
    const sourceDaySet = new Set<string>()
    for (const o of allOrders) {
      const src = o.source || "unknown"
      const rev = revenueOf(o)
      const dateStr = o.pancake_created_at
        ? localDateStr(new Date(o.pancake_created_at))
        : "unknown"
      sourceDaySet.add(dateStr)

      if (!sourceDayMap.has(src)) sourceDayMap.set(src, new Map())
      const dm = sourceDayMap.get(src)!
      const d = dm.get(dateStr) || { orders: 0, revenue: 0 }
      d.orders++; d.revenue += rev
      dm.set(dateStr, d)
    }
    const sourceDays = Array.from(sourceDaySet).filter(d => d !== "unknown").sort()
    const bySourceDay = {
      days: sourceDays,
      sources: bySource.map(s => ({
        source: s.source,
        total_orders: s.orders,
        total_revenue: s.revenue,
        per_day: sourceDays.map(d => {
          const cell = sourceDayMap.get(s.source)?.get(d)
          return { date: d, orders: cell?.orders ?? 0, revenue: cell?.revenue ?? 0 }
        }),
      })),
    }

    // --- By product ---
    // MY: gắn thêm shop_name + source (platform: tiktok/shopee) của mỗi SP — mỗi SP chỉ bán ở
    // 1 gian hàng/1 sàn (verify thực tế), dùng để lọc dropdown "Doanh số SP theo gian hàng".
    const productMap = new Map<string, { qty: number; revenue: number; shop_name?: string; source?: string }>()
    for (const o of allOrders) {
      const items: any[] = Array.isArray(o.items) ? o.items : []
      for (const item of items) {
        const name = item.name || "—"
        const qty = item.qty || 1
        const price = item.price || 0
        const lineRevenue = price * qty
        const entry = productMap.get(name) || {
          qty: 0, revenue: 0,
          ...(mkt === "MY" ? { shop_name: o.shop_name || "", source: o.source || "" } : {}),
        }
        entry.qty += qty
        entry.revenue += lineRevenue
        if (mkt === "MY" && !entry.shop_name && o.shop_name) entry.shop_name = o.shop_name
        if (mkt === "MY" && !entry.source && o.source) entry.source = o.source
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
          ? localDateStr(new Date(o.pancake_created_at))
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

    // --- By platform (chỉ MY: TikTok vs Shopee, gom theo `source`) ---
    // Cùng ý nghĩa với by_shop_day nhưng gom theo sàn thay vì gian hàng con, để thấy
    // TikTok/Shopee cái nào đang đóng góp nhiều hơn. Loại đơn đã hủy (status 6/7/-1) —
    // doanh số theo sàn tính trên đơn còn hiệu lực, không tính đơn hủy.
    let byPlatformDay: any | undefined
    if (mkt === "MY") {
      const platformMap = new Map<string, { orders: number; revenue: number }>()
      const platformDayMap = new Map<string, Map<string, { orders: number; revenue: number }>>()
      const daySet2 = new Set<string>()
      const platformLabel = (src: string) => (src === "tiktok" ? "TikTok" : src === "shopee" ? "Shopee" : src || "Khác")
      for (const o of allOrders) {
        if (isCancelled(o)) continue
        const plat = platformLabel(o.source)
        const rev = revenueOf(o)
        const dateStr = o.pancake_created_at
          ? localDateStr(new Date(o.pancake_created_at))
          : "unknown"
        daySet2.add(dateStr)

        const p = platformMap.get(plat) || { orders: 0, revenue: 0 }
        p.orders++; p.revenue += rev
        platformMap.set(plat, p)

        if (!platformDayMap.has(plat)) platformDayMap.set(plat, new Map())
        const dm = platformDayMap.get(plat)!
        const d = dm.get(dateStr) || { orders: 0, revenue: 0 }
        d.orders++; d.revenue += rev
        dm.set(dateStr, d)
      }
      const platforms = Array.from(platformMap.entries())
        .map(([platform, data]) => ({ platform, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
      const days2 = Array.from(daySet2).filter(d => d !== "unknown").sort()
      byPlatformDay = {
        days: days2,
        platforms: platforms.map(p => ({
          platform: p.platform,
          total_orders: p.orders,
          total_revenue: p.revenue,
          per_day: days2.map(d => {
            const cell = platformDayMap.get(p.platform)?.get(d)
            return { date: d, orders: cell?.orders ?? 0, revenue: cell?.revenue ?? 0 }
          }),
        })),
      }
    }

    return res.json({
      from,
      to,
      market: mkt,
      source_group: coreOnly ? "core" : "all",
      currency: allOrders[0]?.currency ?? (mkt === "MY" ? "MYR" : "VND"),
      ...(mkt === "MY" ? { myr_to_vnd_rate: await getMyrToVndRate(to) } : {}),
      total_orders: totalOrders,
      total_revenue: totalRevenue,
      success_revenue: successRevenue,
      success_rate: successRate,
      return_rate: returnRate,
      success_count: successCount,
      return_count: returnCount,
      cancel_count: cancelCount,
      // Kỳ liền trước cùng độ dài — dùng cho Δ tăng/giảm ở KPI + theo nguồn.
      prev: {
        from: prevFromDate.toISOString(),
        to: prevToDate.toISOString(),
        total_revenue: prevTotalRevenue,
        success_count: prevSuccessCount,
      },
      by_source: bySource,
      by_source_day: bySourceDay,
      by_day: byDay,
      by_product: byProduct,
      ...(byShop ? { by_shop: byShop, by_shop_day: byShopDay } : {}),
      ...(byPlatformDay ? { by_platform_day: byPlatformDay } : {}),
    })
  } catch (err: any) {
    console.error("[PancakeSync Report API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
