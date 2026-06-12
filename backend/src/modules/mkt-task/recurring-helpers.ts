// Shared helpers cho recurring task: period-key, deadline cuối kỳ, spawn instance.
// Dùng chung bởi job mkt-task-recurring và POST /admin/mkt-tasks (sinh kỳ đầu ngay khi tạo template).

export type Frequency = "once" | "daily" | "weekly" | "monthly"

/** Giờ VN (UTC+7) tại thời điểm `now`. */
export function vnDate(now: Date = new Date()): Date {
  return new Date(now.getTime() + 7 * 3600 * 1000)
}

/** ISO week number (tuần bắt đầu Thứ 2, theo chuẩn ISO 8601). */
function isoWeek(d: Date): { year: number; week: number } {
  // d là ngày theo giờ VN — dùng các getter UTC để khỏi lệch timezone máy chủ
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Mon=0 .. Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // Thứ 5 cùng tuần
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return { year: date.getUTCFullYear(), week }
}

/** period_key của kỳ chứa `vn` (giờ VN) cho từng frequency. */
export function periodKeyFor(frequency: Frequency, vn: Date): string {
  const y = vn.getUTCFullYear()
  const m = String(vn.getUTCMonth() + 1).padStart(2, "0")
  const day = String(vn.getUTCDate()).padStart(2, "0")
  if (frequency === "daily") return `${y}-${m}-${day}`
  if (frequency === "weekly") {
    const { year, week } = isoWeek(vn)
    return `${year}-W${String(week).padStart(2, "0")}`
  }
  if (frequency === "monthly") return `${y}-${m}`
  return `${y}-${m}-${day}` // fallback
}

/**
 * Deadline cuối kỳ (trả về ISO string đại diện 23:59 giờ VN ngày cuối kỳ).
 * daily = hôm nay · weekly = Chủ nhật cùng tuần · monthly = ngày cuối tháng.
 */
export function periodDeadline(frequency: Frequency, vn: Date): Date {
  const y = vn.getUTCFullYear()
  const mo = vn.getUTCMonth()
  let endVN: Date
  if (frequency === "weekly") {
    const dayNum = (vn.getUTCDay() + 6) % 7 // Mon=0 .. Sun=6
    endVN = new Date(Date.UTC(y, mo, vn.getUTCDate() + (6 - dayNum)))
  } else if (frequency === "monthly") {
    endVN = new Date(Date.UTC(y, mo + 1, 0)) // ngày 0 tháng sau = cuối tháng này
  } else {
    endVN = new Date(Date.UTC(y, mo, vn.getUTCDate()))
  }
  // endVN đang là 00:00 "giờ VN" biểu diễn dưới dạng UTC → trừ 7h để ra mốc UTC thật,
  // rồi cộng gần hết ngày để deadline rơi cuối ngày VN.
  const utcMidnightVN = new Date(endVN.getTime() - 7 * 3600 * 1000)
  return new Date(utcMidnightVN.getTime() + (24 * 3600 - 60) * 1000) // 23:59 VN
}

/** Hôm nay (giờ VN) có phải mốc sinh kỳ mới cho frequency không? */
export function shouldSpawnToday(frequency: Frequency, vn: Date): boolean {
  if (frequency === "daily") return true
  if (frequency === "weekly") return ((vn.getUTCDay() + 6) % 7) === 0 // Thứ 2
  if (frequency === "monthly") return vn.getUTCDate() === 1
  return false
}

/** So sánh thứ tự period_key (chuỗi sortable: YYYY-MM-DD, YYYY-Www, YYYY-MM đều so sánh lexicographically đúng trong cùng frequency). */
export function isOlderPeriod(a: string | null, b: string): boolean {
  if (!a) return false
  return a < b
}

/**
 * Tạo 1 instance từ template cho 1 kỳ. Idempotent: bỏ qua nếu đã có instance cùng (template_id, period_key).
 * Trả về instance vừa tạo, hoặc null nếu đã tồn tại / lỗi.
 */
export async function spawnInstanceForPeriod(
  svc: any,
  template: any,
  periodKey: string,
  deadline: Date,
): Promise<any | null> {
  const existing = await svc.listMktTasks(
    { template_id: template.id, period_key: periodKey, deleted_at: null },
    { take: 1 },
  )
  if (existing.length > 0) return null

  return svc.createMktTasks({
    title: template.title,
    type: template.type,
    assignee_id: template.assignee_id,
    created_by: template.created_by,
    deadline,
    status: "todo",
    priority: template.priority || "medium",
    tags: Array.isArray(template.tags) ? template.tags : [],
    notes: template.notes || null,
    comments: [],
    output: template.output || null,
    result: null,
    // Mỗi kỳ nhận bản copy checklist của template, reset chưa tick
    checklist: Array.isArray(template.checklist)
      ? template.checklist.map((i: any) => ({ ...i, done: false }))
      : null,
    frequency: "once",          // instance là việc 1 lần cụ thể
    is_template: false,
    template_id: template.id,
    period_key: periodKey,
    channel_id: template.channel_id || null,
  })
}
