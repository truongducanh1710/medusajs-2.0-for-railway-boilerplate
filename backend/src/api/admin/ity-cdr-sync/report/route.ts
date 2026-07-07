import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/ity-cdr-sync/report?from=...&to=...
 * Báo cáo so sánh hiệu suất cuộc gọi theo nhân viên (extension) + xu hướng theo giờ.
 * Mặc định: hôm nay (theo giờ VN).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.query as Record<string, string | undefined>

    const nowVN = new Date(Date.now() + 7 * 3600 * 1000)
    const todayStr = nowVN.toISOString().slice(0, 10)
    const fromDate = from ? new Date(from) : new Date(`${todayStr}T00:00:00+07:00`)
    const toDate = to ? new Date(to) : new Date(`${todayStr}T23:59:59+07:00`)

    const syncService = req.scope.resolve("ityCdrSyncModule") as any

    const calls = await syncService.listItyCdrCalls(
      { calldate: { $gte: fromDate, $lte: toDate } } as any,
      { take: 100_000, select: ["extension", "calldate", "billsec", "disposition"] as any }
    )

    const maps = await syncService.listItyExtensionMaps({})
    const nameByExtension: Record<string, string> = Object.fromEntries(
      maps.map((m: any) => [m.extension, m.display_name || m.extension])
    )

    // ---- Aggregate theo extension (so sánh sale) ----
    const byExt: Record<string, { total: number; answered: number; totalBillsec: number }> = {}
    // ---- Aggregate theo giờ (xu hướng thời gian) ----
    const byHour: Record<number, { total: number; answered: number }> = {}
    for (let h = 0; h < 24; h++) byHour[h] = { total: 0, answered: 0 }

    for (const c of calls as any[]) {
      const ext = c.extension || "unknown"
      if (!byExt[ext]) byExt[ext] = { total: 0, answered: 0, totalBillsec: 0 }
      byExt[ext].total++
      if (c.disposition === "ANSWERED") byExt[ext].answered++
      byExt[ext].totalBillsec += c.billsec || 0

      const hourVN = new Date(new Date(c.calldate).getTime() + 7 * 3600 * 1000).getUTCHours()
      byHour[hourVN].total++
      if (c.disposition === "ANSWERED") byHour[hourVN].answered++
    }

    const bySale = Object.entries(byExt)
      .map(([extension, stats]) => ({
        extension,
        name: nameByExtension[extension] || extension,
        total_calls: stats.total,
        answered: stats.answered,
        answered_rate: stats.total > 0 ? Math.round((stats.answered / stats.total) * 1000) / 10 : 0,
        total_talk_seconds: stats.totalBillsec,
        avg_talk_seconds: stats.answered > 0 ? Math.round(stats.totalBillsec / stats.answered) : 0,
      }))
      .sort((a, b) => b.total_calls - a.total_calls)

    const byHourArr = Object.entries(byHour).map(([hour, stats]) => ({
      hour: Number(hour),
      total_calls: stats.total,
      answered: stats.answered,
    }))

    return res.json({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      total_calls: calls.length,
      by_sale: bySale,
      by_hour: byHourArr,
    })
  } catch (err: any) {
    console.error("[ItyCdrSync Report API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
