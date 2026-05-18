import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

function calcPriority(o: any): { score: number; level: string; reason: string } {
  const notes: any[] = Array.isArray(o.notes) ? o.notes : []
  const tags: any[]  = Array.isArray(o.tags)  ? o.tags  : []
  const tagNames = tags.map((t: any) => String(t?.name ?? "").toLowerCase().replace(/\s/g, ""))

  // Mỗi note = 1 lần tác động (bất kỳ nội dung gì)
  const noteCount = notes.length

  const hasGoiThatBai = tagNames.some((t) =>
    t.includes("trangthaigoilan1thatbai") || t.includes("thatbai")
  )

  const hoursOld = o.pancake_created_at
    ? Math.min((Date.now() - new Date(o.pancake_created_at).getTime()) / 3_600_000, 24)
    : 0

  const hoursSinceLastNote = o.last_note_at
    ? (Date.now() - new Date(o.last_note_at).getTime()) / 3_600_000
    : 99

  let base = 0
  let reason = ""

  if (noteCount >= 3)       { base = 40; reason = `KNM ${noteCount} lần` }
  else if (noteCount === 2) { base = 35; reason = "KNM 2 lần — cần gọi lần 3" }
  else if (noteCount === 1) { base = 25; reason = "KNM 1 lần — cần follow up" }
  else                      { base = 30; reason = "Chưa tác động" }

  const score = Math.round(
    base +
    hoursOld +
    (hasGoiThatBai ? 10 : 0) +
    (hoursSinceLastNote > 4 ? 5 : 0)
  )

  const level =
    score >= 45 ? "critical" :
    score >= 30 ? "high" :
    score >= 15 ? "medium" : "low"

  if (hoursOld > 8) reason += ` · ${Math.round(hoursOld)}h chưa chốt`

  return { score, level, reason }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const q = req.query as Record<string, string>
    const date = q.date ?? new Date().toISOString().slice(0, 10)
    const days = Math.min(Math.max(Number(q.days ?? 1), 1), 30) // 1-30 ngày, default 1
    const sellerFilter = q.seller ?? ""

    // Khi days=1: chỉ lấy đúng ngày date. Khi days>1: lấy N ngày kết thúc vào cuối ngày date
    const dayEnd   = new Date(`${date}T23:59:59+07:00`)
    const dayStart = days === 1
      ? new Date(`${date}T00:00:00+07:00`)
      : new Date(dayEnd.getTime() - (days - 1) * 24 * 3600_000 - (dayEnd.getTime() % 86400_000 === 0 ? 0 : 0))

    // Với multi-day, lấy từ 00:00 ngày đầu đến 23:59 ngày cuối
    const rangeStart = days === 1
      ? new Date(`${date}T00:00:00+07:00`)
      : new Date(dayEnd.getTime() - (days - 1) * 24 * 3600_000)

    // Lấy đơn status=0 trong khoảng
    const all = await syncService.listPancakeOrders(
      {},
      { take: days > 1 ? 1500 : 500, order: { pancake_created_at: "DESC" } }
    )

    let orders = all.filter((o: any) => {
      const d = o.pancake_created_at ? new Date(o.pancake_created_at) : null
      return d && d >= rangeStart && d <= dayEnd && o.status === 0
    })

    if (sellerFilter) {
      orders = orders.filter((o: any) =>
        String(o.sale_name ?? "").toLowerCase().includes(sellerFilter.toLowerCase())
      )
    }

    // Tính priority cho từng đơn
    const prioritized = orders.map((o: any) => {
      const { score, level, reason } = calcPriority(o)
      const hoursOld = o.pancake_created_at
        ? Math.round((Date.now() - new Date(o.pancake_created_at).getTime()) / 3_600_000 * 10) / 10
        : 0

      const notes: any[] = Array.isArray(o.notes) ? o.notes : []

      return {
        id: o.id,
        customer_name: o.customer_name,
        customer_phone: o.customer_phone,
        sale_name: o.sale_name,
        product_summary: Array.isArray(o.items)
          ? o.items.map((i: any) => `${i.name} x${i.qty}`).join(", ")
          : "",
        total: o.total,
        pancake_created_at: o.pancake_created_at,
        hours_old: hoursOld,
        call_count: o.call_count ?? 0,
        last_note_at: o.last_note_at,
        notes: notes.map((n: any) => ({
          message: n.message,
          by: n.by,
          at: n.at_ms ? new Date(n.at_ms).toISOString() : null,
        })),
        tags: Array.isArray(o.tags) ? o.tags : [],
        pancake_link: (o.raw as any)?.order_link ?? null,
        priority_score: score,
        priority_level: level,
        urgency_reason: reason,
      }
    }).sort((a: any, b: any) => b.priority_score - a.priority_score)

    // Summary theo level
    const summary = {
      total: prioritized.length,
      critical: prioritized.filter((o: any) => o.priority_level === "critical").length,
      high:     prioritized.filter((o: any) => o.priority_level === "high").length,
      medium:   prioritized.filter((o: any) => o.priority_level === "medium").length,
      low:      prioritized.filter((o: any) => o.priority_level === "low").length,
    }

    // Lấy danh sách sellers
    const sellersMap = new Map<string, string>()
    for (const o of prioritized) {
      if (o.sale_name) sellersMap.set(o.sale_name, o.sale_name)
    }
    const sellers = Array.from(sellersMap.keys()).map((name) => ({ id: name, name }))

    return res.json({ date, days, orders: prioritized, summary, sellers })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
