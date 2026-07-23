import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Chuẩn hoá from/to về đúng mốc UTC của đầu/cuối ngày GIỜ VN. BUG THẬT đã xảy ra: khi
// caller gửi "YYYY-MM-DD" thuần (không có phần giờ — đúng cách agent-mcp's
// get_call_performance luôn gửi, vì model chỉ biết sinh ngày ISO, không tự biết phải
// thêm "T00:00:00+07:00"), `new Date("2026-07-22")` bị JS parse là UTC 00:00, LỆCH 7
// TIẾNG so với "00:00 giờ VN" thật (= 2026-07-21T17:00:00Z). Hệ quả: from===to cùng một
// mốc UTC, khoảng lọc calldate dài 0 giây → BETWEEN gần như không khớp cuộc gọi nào,
// agent kết luận sai "hôm qua không có dữ liệu" dù DB có đủ. UI/page.tsx không dính vì
// nó tự thêm "T00:00:00+07:00"/"T23:59:59+07:00" trước khi gọi API (xem admin/routes/
// ity-cdr/page.tsx's fetchReport) — nhưng route KHÔNG nên ngầm định mọi caller làm vậy;
// chuẩn hoá ngay tại nguồn để đúng với MỌI client (UI, agent, MCP...), không phải sửa
// từng nơi gọi. isBareDate dùng đúng regex đã có ở toVNDate() (gia-von/avg-cost/route.ts).
const isBareDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
function startOfDayVN(dateStr: string): Date {
  return isBareDate(dateStr) ? new Date(`${dateStr}T00:00:00+07:00`) : new Date(dateStr)
}
function endOfDayVN(dateStr: string): Date {
  return isBareDate(dateStr) ? new Date(`${dateStr}T23:59:59+07:00`) : new Date(dateStr)
}

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
    const fromDate = from ? startOfDayVN(from) : new Date(`${todayStr}T00:00:00+07:00`)
    const toDate = to ? endOfDayVN(to) : new Date(`${todayStr}T23:59:59+07:00`)

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
    // ---- Aggregate theo giờ × nhân viên (cho heatmap — thấy khoảng "chết" của từng người) ----
    const byHourExt: Record<string, Record<number, { total: number; answered: number }>> = {}
    // ---- Aggregate theo ngày × nhân viên × trạng thái (cho chart tuần/tháng) ----
    const byDaySale: Record<string, Record<string, { answered: number; no_answer: number; busy: number; other: number }>> = {}
    // ---- Aggregate theo ngày × nhân viên (tổng cuộc gọi — cho sparkline 7 ngày trong bảng so sánh) ----
    const byDayExtTotal: Record<string, Record<string, number>> = {}

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

      if (!byHourExt[ext]) {
        byHourExt[ext] = {}
        for (let h = 0; h < 24; h++) byHourExt[ext][h] = { total: 0, answered: 0 }
      }
      byHourExt[ext][hourVN].total++
      if (c.disposition === "ANSWERED") byHourExt[ext][hourVN].answered++

      const dayStr = callDateVN.toISOString().slice(0, 10)
      byExt[ext].activeDays.add(dayStr)
      if (!byDaySale[dayStr]) byDaySale[dayStr] = {}
      if (!byDaySale[dayStr][ext]) byDaySale[dayStr][ext] = { answered: 0, no_answer: 0, busy: 0, other: 0 }
      const bucket = byDaySale[dayStr][ext]
      if (c.disposition === "ANSWERED") bucket.answered++
      else if (c.disposition === "NO ANSWER") bucket.no_answer++
      else if (c.disposition === "BUSY") bucket.busy++
      else bucket.other++

      if (!byDayExtTotal[ext]) byDayExtTotal[ext] = {}
      byDayExtTotal[ext][dayStr] = (byDayExtTotal[ext][dayStr] || 0) + 1
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

    // Heatmap giờ × nhân viên — lộ khoảng "chết" của từng người trong ca, không bị gộp
    // chung như by_hour (chỉ tính nhân viên có ít nhất 1 cuộc trong khoảng đã chọn).
    const byHourExtArr = Object.entries(byExt).map(([extension]) => ({
      extension,
      name: nameByExtension[extension] || extension,
      hours: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        total_calls: byHourExt[extension]?.[h]?.total ?? 0,
        answered: byHourExt[extension]?.[h]?.answered ?? 0,
      })),
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

    // Xu hướng 7 ngày gần nhất tính tới `to` — độc lập với khoảng đã chọn (kể cả khi chọn
    // "Hôm nay"/"Hôm qua" chỉ 1 ngày, sparkline trong bảng so sánh vẫn có đủ 7 điểm để nhìn xu hướng).
    const trendToDate = toDate
    const trendFromDate = new Date(trendToDate.getTime() - 6 * 86400_000)
    const trendCalls = await syncService.listItyCdrCalls(
      { calldate: { $gte: trendFromDate, $lte: trendToDate } } as any,
      { take: 100_000, select: ["extension", "calldate"] as any }
    )
    const trendByExtDay: Record<string, Record<string, number>> = {}
    for (const c of trendCalls as any[]) {
      const ext = c.extension || "unknown"
      const callDateVN = new Date(new Date(c.calldate).getTime() + 7 * 3600 * 1000)
      const dayStr = callDateVN.toISOString().slice(0, 10)
      if (!trendByExtDay[ext]) trendByExtDay[ext] = {}
      trendByExtDay[ext][dayStr] = (trendByExtDay[ext][dayStr] || 0) + 1
    }
    const trendDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(trendFromDate.getTime() + i * 86400_000)
      return d.toISOString().slice(0, 10)
    })
    const saleTrend: Record<string, number[]> = {}
    for (const extension of Object.keys(byExt)) {
      saleTrend[extension] = trendDays.map((d) => trendByExtDay[extension]?.[d] ?? 0)
    }

    return res.json({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      shift_hours: shiftHours,
      total_calls: calls.length,
      by_sale: bySale.map((s) => ({ ...s, trend_7d: saleTrend[s.extension] ?? [] })),
      by_hour: byHourArr,
      by_hour_ext: byHourExtArr,
      by_day: byDayArr,
      trend_days: trendDays,
    })
  } catch (err: any) {
    console.error("[ItyCdrSync Report API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
