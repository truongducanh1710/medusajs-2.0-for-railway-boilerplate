import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/ity-cdr-sync/report?from=...&to=...
 * Báo cáo so sánh hiệu suất cuộc gọi theo nhân viên (extension) + xu hướng theo giờ.
 * Mặc định: hôm nay (theo giờ VN).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.query as Record<string, string | undefined>
    const shiftHours = Number(req.query.shift_hours ?? 7) || 7

    const nowVN = new Date(Date.now() + 7 * 3600 * 1000)
    const todayStr = nowVN.toISOString().slice(0, 10)
    const fromDate = from ? new Date(from) : new Date(`${todayStr}T00:00:00+07:00`)
    const toDate = to ? new Date(to) : new Date(`${todayStr}T23:59:59+07:00`)

    const syncService = req.scope.resolve("ityCdrSyncModule") as any

    const calls = await syncService.listItyCdrCalls(
      { calldate: { $gte: fromDate, $lte: toDate } } as any,
      { take: 100_000, select: ["extension", "calldate", "duration", "billsec", "disposition"] as any }
    )

    const maps = await syncService.listItyExtensionMaps({})
    const nameByExtension: Record<string, string> = Object.fromEntries(
      maps.map((m: any) => [m.extension, m.display_name || m.extension])
    )

    // ---- Aggregate theo extension (so sánh sale) ----
    const byExt: Record<string, { total: number; answered: number; totalBillsec: number; totalDuration: number; activeDays: Set<string> }> = {}
    // ---- Aggregate theo giờ (xu hướng thời gian trong ngày) ----
    const byHour: Record<number, { total: number; answered: number }> = {}
    for (let h = 0; h < 24; h++) byHour[h] = { total: 0, answered: 0 }
    // ---- Aggregate theo ngày × nhân viên × trạng thái (cho chart tuần/tháng) ----
    const byDaySale: Record<string, Record<string, { answered: number; no_answer: number; busy: number; other: number }>> = {}

    for (const c of calls as any[]) {
      const ext = c.extension || "unknown"
      if (!byExt[ext]) byExt[ext] = { total: 0, answered: 0, totalBillsec: 0, totalDuration: 0, activeDays: new Set() }
      byExt[ext].total++
      if (c.disposition === "ANSWERED") byExt[ext].answered++
      byExt[ext].totalBillsec += c.billsec || 0
      byExt[ext].totalDuration += c.duration || 0

      const callDateVN = new Date(new Date(c.calldate).getTime() + 7 * 3600 * 1000)
      const hourVN = callDateVN.getUTCHours()
      byHour[hourVN].total++
      if (c.disposition === "ANSWERED") byHour[hourVN].answered++

      const dayStr = callDateVN.toISOString().slice(0, 10)
      byExt[ext].activeDays.add(dayStr)
      if (!byDaySale[dayStr]) byDaySale[dayStr] = {}
      if (!byDaySale[dayStr][ext]) byDaySale[dayStr][ext] = { answered: 0, no_answer: 0, busy: 0, other: 0 }
      const bucket = byDaySale[dayStr][ext]
      if (c.disposition === "ANSWERED") bucket.answered++
      else if (c.disposition === "NO ANSWER") bucket.no_answer++
      else if (c.disposition === "BUSY") bucket.busy++
      else bucket.other++
    }

    const bySale = Object.entries(byExt)
      .map(([extension, stats]) => {
        // Mẫu số = số ngày nhân viên THỰC SỰ có cuộc gọi trong khoảng đã chọn × giờ/ca —
        // tránh xem tuần/tháng mà vẫn chia cho 1 ca duy nhất (khiến % bị nhỏ giả tạo).
        const activeDayCount = Math.max(1, stats.activeDays.size)
        const shiftSeconds = shiftHours * 3600 * activeDayCount
        return {
          extension,
          name: nameByExtension[extension] || extension,
          total_calls: stats.total,
          answered: stats.answered,
          answered_rate: stats.total > 0 ? Math.round((stats.answered / stats.total) * 1000) / 10 : 0,
          total_talk_seconds: stats.totalBillsec,
          avg_talk_seconds: stats.answered > 0 ? Math.round(stats.totalBillsec / stats.answered) : 0,
          total_call_time_seconds: stats.totalDuration,
          active_days: activeDayCount,
          call_time_ratio: Math.round((stats.totalDuration / shiftSeconds) * 1000) / 10,
        }
      })
      .sort((a, b) => b.total_calls - a.total_calls)

    const byHourArr = Object.entries(byHour).map(([hour, stats]) => ({
      hour: Number(hour),
      total_calls: stats.total,
      answered: stats.answered,
    }))

    // Mảng phẳng theo ngày, mỗi ngày có breakdown từng nhân viên — dùng để vẽ combo chart
    // (cột stacked theo trạng thái + đường tỷ lệ nghe máy, toggle theo nhân viên ở frontend)
    const byDayArr = Object.keys(byDaySale)
      .sort()
      .map((day) => ({
        day,
        by_extension: Object.entries(byDaySale[day]).map(([extension, b]) => {
          const total = b.answered + b.no_answer + b.busy + b.other
          return {
            extension,
            name: nameByExtension[extension] || extension,
            answered: b.answered,
            no_answer: b.no_answer,
            busy: b.busy,
            other: b.other,
            total,
            answered_rate: total > 0 ? Math.round((b.answered / total) * 1000) / 10 : 0,
          }
        }),
      }))

    return res.json({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      shift_hours: shiftHours,
      total_calls: calls.length,
      by_sale: bySale,
      by_hour: byHourArr,
      by_day: byDayArr,
    })
  } catch (err: any) {
    console.error("[ItyCdrSync Report API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
