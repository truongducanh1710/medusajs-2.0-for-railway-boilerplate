import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const CONFIRMED_STATUSES = [2, 3, 4, 5, 6]
const CANCELLED_STATUSES = [-1, -2, 7]

function dayRangeVN(date: string) {
  return {
    start: new Date(`${date}T00:00:00+07:00`),
    end:   new Date(`${date}T23:59:59+07:00`),
  }
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00+07:00`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function computeStats(orders: any[], now: Date, periodEnd: Date) {
  let no_action = 0, called = 0, knm_1 = 0, knm_2 = 0, knm_3_plus = 0
  let confirmed = 0, cancelled = 0, overdue = 0, total_notes = 0
  let revenue = 0

  for (const o of orders) {
    const notes = Array.isArray(o.notes) ? o.notes : []
    const tags  = Array.isArray(o.tags)  ? o.tags  : []
    total_notes += notes.length

    if (CONFIRMED_STATUSES.includes(o.status)) {
      confirmed++
      revenue += Number(o.total) || 0
    } else if (CANCELLED_STATUSES.includes(o.status)) {
      cancelled++
    } else {
      const tagNames = tags.map((t: any) => String(t?.name ?? "").toLowerCase())
      if (tagNames.some((t: string) => t.includes("hủy") || t.includes("cancel"))) {
        cancelled++
      } else {
        // Mỗi note = 1 lần tác động (bất kỳ nội dung gì)
        const noteCount = notes.length
        if (noteCount >= 3)        knm_3_plus++
        else if (noteCount === 2)  knm_2++
        else if (noteCount === 1)  knm_1++
        else {
          no_action++
          if (o.pancake_created_at && now > periodEnd) overdue++
        }
      }
    }
  }
  return { no_action, called, knm_1, knm_2, knm_3_plus, confirmed, cancelled, overdue, total_notes, revenue }
}

/**
 * GET /admin/pancake-sync/report/sale-performance
 *   ?date=YYYY-MM-DD  (1 ngày, default hôm nay)
 *   hoặc ?range=7d|14d|30d  (gom nhiều ngày, end = hôm nay)
 *   hoặc ?from=YYYY-MM-DD&to=YYYY-MM-DD  (custom range)
 *   &seller=Linh  (optional, filter chỉ 1 sale → giảm payload cho sale tự xem)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const q = req.query as Record<string, string>
    const today = new Date().toISOString().slice(0, 10)

    // Xác định range
    let fromDate: string, toDate: string
    if (q.from && q.to) {
      fromDate = q.from
      toDate = q.to
    } else if (q.range) {
      const days = q.range === "14d" ? 14 : q.range === "30d" ? 30 : 7
      toDate = q.to || today
      fromDate = shiftDate(toDate, -(days - 1))
    } else {
      // Single date (backward compat)
      fromDate = q.date || today
      toDate = q.date || today
    }

    const periodStart = dayRangeVN(fromDate).start
    const periodEnd   = dayRangeVN(toDate).end
    const seller      = q.seller?.trim()

    // Lấy đơn trong khoảng
    const filters: any = {
      pancake_created_at: { $gte: periodStart, $lte: periodEnd },
    }
    if (seller) filters.sale_name = seller

    const orders = await syncService.listPancakeOrders(filters, {
      take: 10000,
      order: { pancake_created_at: "DESC" },
    })

    // Group theo sale
    const byS: Record<string, any[]> = {}
    for (const o of orders) {
      const key = o.sale_name || "(chưa assign)"
      if (!byS[key]) byS[key] = []
      byS[key].push(o)
    }

    const now = new Date()
    const isMultiDay = fromDate !== toDate
    const dayCount = isMultiDay
      ? Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) + 1
      : 1

    const sales = Object.entries(byS).map(([sale_name, list]) => {
      const s = computeStats(list, now, periodEnd)
      const total = list.length
      return {
        sale_name,
        total,
        ...s,
        confirm_rate: total > 0 ? Math.round(s.confirmed / total * 1000) / 10 : 0,
        knm_rate: total > 0 ? Math.round((s.knm_1 + s.knm_2 + s.knm_3_plus) / total * 1000) / 10 : 0,
        avg_notes: total > 0 ? Math.round(s.total_notes / total * 10) / 10 : 0,
        avg_per_day: dayCount > 0 ? Math.round(total / dayCount * 10) / 10 : total,
      }
    }).sort((a, b) => b.total - a.total)

    const totalConfirmed = sales.reduce((sum, x) => sum + x.confirmed, 0)
    const totalCancelled = sales.reduce((sum, x) => sum + x.cancelled, 0)
    const totalKnm = sales.reduce((sum, x) => sum + x.knm_1 + x.knm_2 + x.knm_3_plus, 0)
    const totalRevenue = sales.reduce((sum, x) => sum + x.revenue, 0)
    const totalNoAction = sales.reduce((sum, x) => sum + x.no_action, 0)

    return res.json({
      from: fromDate,
      to: toDate,
      day_count: dayCount,
      date: fromDate === toDate ? fromDate : undefined, // backward compat
      sales,
      summary: {
        total_orders: orders.length,
        total_confirmed: totalConfirmed,
        total_cancelled: totalCancelled,
        total_knm: totalKnm,
        total_no_action: totalNoAction,
        total_revenue: totalRevenue,
        overall_confirm_rate: orders.length > 0
          ? Math.round(totalConfirmed / orders.length * 1000) / 10 : 0,
        avg_orders_per_day: dayCount > 0
          ? Math.round(orders.length / dayCount * 10) / 10 : orders.length,
      },
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
