import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const CONFIRMED_STATUSES = [2, 3, 4, 5, 6]
const CANCELLED_STATUSES = [-1, -2, 7]

function dayRangeVN(dateStr: string) {
  return {
    start: new Date(`${dateStr}T00:00:00+07:00`),
    end:   new Date(`${dateStr}T23:59:59+07:00`),
  }
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00+07:00`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null
  return Math.round(((curr - prev) / prev) * 1000) / 10
}

function aggregateDay(orders: any[]) {
  let revenue = 0
  let confirmed = 0
  let cancelled = 0
  for (const o of orders) {
    if (CONFIRMED_STATUSES.includes(o.status)) {
      confirmed++
      revenue += Number(o.total) || 0
    } else if (CANCELLED_STATUSES.includes(o.status)) {
      cancelled++
    }
  }
  return {
    total: orders.length,
    confirmed,
    cancelled,
    revenue,
    confirm_rate: orders.length > 0 ? Math.round(confirmed / orders.length * 1000) / 10 : 0,
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const q = req.query as Record<string, string>
    const date = q.date ?? new Date().toISOString().slice(0, 10)
    const yesterday = shiftDate(date, -1)
    const weekAgoStart = shiftDate(date, -6)

    const todayRange    = dayRangeVN(date)
    const yesterdayRange = dayRangeVN(yesterday)
    const weekRange     = { start: dayRangeVN(weekAgoStart).start, end: todayRange.end }

    // Fetch a wider net then partition by date locally (cheaper than 3 queries)
    const all = await syncService.listPancakeOrders(
      { pancake_created_at: { $gte: weekRange.start, $lte: weekRange.end } },
      {
        take: 5000,
        select: ["id", "status", "total", "pancake_created_at", "sale_name", "notes", "last_note_at"],
        order: { pancake_created_at: "DESC" },
      }
    )

    const partition = (start: Date, end: Date) =>
      all.filter((o: any) => {
        const d = o.pancake_created_at ? new Date(o.pancake_created_at) : null
        return d && d >= start && d <= end
      })

    const todayOrders = partition(todayRange.start, todayRange.end)
    const yesterdayOrders = partition(yesterdayRange.start, yesterdayRange.end)

    const today = aggregateDay(todayOrders)
    const yest  = aggregateDay(yesterdayOrders)

    // Mini chart 7 ngày
    const byDay: any[] = []
    for (let i = 6; i >= 0; i--) {
      const d = shiftDate(date, -i)
      const r = dayRangeVN(d)
      const orders = partition(r.start, r.end)
      const a = aggregateDay(orders)
      byDay.push({ date: d, orders: a.total, confirmed: a.confirmed, revenue: a.revenue, confirm_rate: a.confirm_rate })
    }

    // Overdue: status=0, hoursOld > 24
    const now = Date.now()
    const allActive = await syncService.listPancakeOrders(
      { status: 0 },
      { take: 1000, select: ["id", "sale_name", "pancake_created_at", "customer_name", "customer_phone"] }
    )
    const overdueList = allActive.filter((o: any) => {
      if (!o.pancake_created_at) return false
      const hours = (now - new Date(o.pancake_created_at).getTime()) / 3_600_000
      return hours > 24
    })
    const overdueBySale: Record<string, number> = {}
    for (const o of overdueList) {
      const k = o.sale_name || "(chưa assign)"
      overdueBySale[k] = (overdueBySale[k] || 0) + 1
    }

    // Sale alerts: hôm nay confirm_rate thấp hơn TB tuần >20pp (chỉ tính sale có ≥3 đơn hôm nay)
    const salesAlerts: any[] = []
    const todayBySale: Record<string, any[]> = {}
    for (const o of todayOrders) {
      const k = o.sale_name || "(chưa assign)"
      if (!todayBySale[k]) todayBySale[k] = []
      todayBySale[k].push(o)
    }
    const weekBySale: Record<string, any[]> = {}
    for (const o of all) {
      const k = o.sale_name || "(chưa assign)"
      if (!weekBySale[k]) weekBySale[k] = []
      weekBySale[k].push(o)
    }
    for (const [sale, list] of Object.entries(todayBySale)) {
      if (list.length < 3) continue
      const todayAgg = aggregateDay(list)
      const weekAgg  = aggregateDay(weekBySale[sale] || [])
      if (weekAgg.confirm_rate - todayAgg.confirm_rate > 20) {
        salesAlerts.push({
          sale_name: sale,
          today_rate: todayAgg.confirm_rate,
          week_rate: weekAgg.confirm_rate,
          today_orders: list.length,
        })
      }
    }

    return res.json({
      date,
      kpis: {
        orders_today: today.total,
        orders_delta: pctDelta(today.total, yest.total),
        revenue_today: today.revenue,
        revenue_delta: pctDelta(today.revenue, yest.revenue),
        confirm_rate_today: today.confirm_rate,
        confirm_rate_delta_pp: Math.round((today.confirm_rate - yest.confirm_rate) * 10) / 10,
        overdue_count: overdueList.length,
      },
      alerts: {
        overdue: {
          count: overdueList.length,
          by_sale: Object.entries(overdueBySale)
            .map(([sale_name, count]) => ({ sale_name, count }))
            .sort((a, b) => b.count - a.count),
        },
        sale_drops: salesAlerts.sort((a, b) => (b.week_rate - b.today_rate) - (a.week_rate - a.today_rate)),
      },
      mini_chart: byDay,
      quick: {
        priority_count: allActive.length,
        overdue_count: overdueList.length,
      },
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
