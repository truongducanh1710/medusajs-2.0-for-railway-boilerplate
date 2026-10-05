// Số NGÀY CÔNG của một đơn nghỉ/online, theo giờ VN.
//
// Trước đây lấy (end - start) / 8 giờ: đơn 08:30-17:30 thành 9/8 = 1.13 ngày (tính cả giờ
// nghỉ trưa), đơn nhiều ngày còn cộng cả ban đêm (08:30 thứ 2 → 17:30 thứ 4 = 7.1 ngày) — và
// con số đó bị trừ thẳng vào phép năm khi duyệt.
//
// Giờ chia theo BUỔI: sáng 08:30-12:00 = 0.5 ngày, chiều 13:30-17:30 = 0.5 ngày (khớp preset
// "Buổi sáng"/"Buổi chiều" ở form tạo đơn). Nghỉ một phần buổi thì tính theo tỷ lệ phút.
// Bỏ ngày không làm việc (CN) và buổi chiều của T7 nửa ngày.
const SESSIONS: [number, number][] = [
  [8 * 60 + 30, 12 * 60],
  [13 * 60 + 30, 17 * 60 + 30],
]
const VN_OFFSET = 7 * 3600_000

export function leaveWorkDays(
  startAt: string | Date,
  endAt: string | Date,
  opts: { work_days?: number[]; half_day_saturdays?: string[] } = {},
): number {
  const workDays = opts.work_days ?? [1, 2, 3, 4, 5, 6]
  const halfSat = new Set(opts.half_day_saturdays ?? [])
  const start = new Date(startAt).getTime()
  const end = new Date(endAt).getTime()
  if (!(end > start)) return 0

  let total = 0
  // Duyệt từng ngày VN từ ngày bắt đầu tới ngày kết thúc.
  let dayStartUtc = Math.floor((start + VN_OFFSET) / 86400_000) * 86400_000 - VN_OFFSET
  for (; dayStartUtc < end; dayStartUtc += 86400_000) {
    const vnDate = new Date(dayStartUtc + VN_OFFSET)
    const dow = vnDate.getUTCDay()
    if (!workDays.includes(dow)) continue
    const dayKey = vnDate.toISOString().slice(0, 10)
    SESSIONS.forEach(([s, e], i) => {
      if (i === 1 && halfSat.has(dayKey)) return
      const sAbs = dayStartUtc + s * 60_000
      const eAbs = dayStartUtc + e * 60_000
      const overlap = Math.max(0, Math.min(end, eAbs) - Math.max(start, sAbs))
      total += 0.5 * overlap / (eAbs - sAbs)
    })
  }
  return Math.round(total * 100) / 100
}
