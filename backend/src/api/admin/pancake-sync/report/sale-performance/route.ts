import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const CONFIRMED_STATUSES = [2, 3, 4, 5, 6]
const CANCELLED_STATUSES = [-1, -2, 7]

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const date = (req.query as any).date ?? new Date().toISOString().slice(0, 10)
    const dayStart = new Date(`${date}T00:00:00+07:00`)
    const dayEnd   = new Date(`${date}T23:59:59+07:00`)

    // Lấy tất cả đơn trong ngày bất kể status
    const all = await syncService.listPancakeOrders(
      {},
      { take: 1000, order: { pancake_created_at: "DESC" } }
    )
    const orders = all.filter((o: any) => {
      const d = o.pancake_created_at ? new Date(o.pancake_created_at) : null
      return d && d >= dayStart && d <= dayEnd
    })

    // Group theo sale_name
    const byS: Record<string, any[]> = {}
    for (const o of orders) {
      const key = o.sale_name || "(chưa assign)"
      if (!byS[key]) byS[key] = []
      byS[key].push(o)
    }

    const now = new Date()
    const sales = Object.entries(byS).map(([sale_name, list]) => {
      let no_action = 0, called = 0, knm_1 = 0, knm_2 = 0, knm_3_plus = 0
      let confirmed = 0, cancelled = 0, overdue = 0, total_notes = 0

      for (const o of list) {
        const notes = Array.isArray(o.notes) ? o.notes : []
        const tags  = Array.isArray(o.tags)  ? o.tags  : []
        total_notes += notes.length

        if (CONFIRMED_STATUSES.includes(o.status)) {
          // Đơn đã lên kho — xác nhận thực sự
          confirmed++
        } else if (CANCELLED_STATUSES.includes(o.status)) {
          cancelled++
        } else {
          // status=0 — còn chờ xử lý, tính từ notes/tags
          const tagNames = tags.map((t: any) => String(t?.name ?? "").toLowerCase())
          if (tagNames.some((t: string) => t.includes("hủy") || t.includes("cancel"))) {
            cancelled++
          } else {
            const knmCount = notes.filter((n: any) =>
              String(n.message ?? "").toUpperCase().includes("KNM")
            ).length
            if (knmCount >= 3)         knm_3_plus++
            else if (knmCount === 2)   knm_2++
            else if (knmCount === 1)   knm_1++
            else if (notes.length > 0) called++
            else {
              no_action++
              if (o.pancake_created_at && now > dayEnd) overdue++
            }
          }
        }
      }

      const total = list.length
      return {
        sale_name,
        total,
        no_action,
        called,
        knm_1,
        knm_2,
        knm_3_plus,
        confirmed,
        cancelled,
        overdue,
        confirm_rate: total > 0 ? Math.round(confirmed / total * 1000) / 10 : 0,
        knm_rate: total > 0 ? Math.round((knm_1 + knm_2 + knm_3_plus) / total * 1000) / 10 : 0,
        avg_notes: total > 0 ? Math.round(total_notes / total * 10) / 10 : 0,
      }
    }).sort((a, b) => b.no_action - a.no_action)

    const totalConfirmed = sales.reduce((s, x) => s + x.confirmed, 0)
    const totalKnm = sales.reduce((s, x) => s + x.knm_1 + x.knm_2 + x.knm_3_plus, 0)

    return res.json({
      date,
      sales,
      summary: {
        total_orders: orders.length,
        total_confirmed: totalConfirmed,
        total_knm: totalKnm,
        overall_confirm_rate: orders.length > 0
          ? Math.round(totalConfirmed / orders.length * 1000) / 10 : 0,
      },
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
