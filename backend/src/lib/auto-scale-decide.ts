// Quyết định tự scale — hàm thuần, không gọi FB/DB, để chạy mô phỏng và kiểm thử.
// runAutoScale (auto-scale.ts) thu thập số liệu rồi gọi hàm này.

export type DecideRule = {
  target_cpa: number
  min_orders: number
  spend_ratio: number
  multiplier: number
  max_budget: number
  cooldown_min: number
  revert_factor: number
  hour_from: number
  hour_to: number
  nightly_reset: boolean
}

export type DecideInput = {
  hour: number
  minute: number
  rule: DecideRule
  base: number
  budget: number                 // ngân sách hiện tại trên FB (0 = ABO)
  status: string                 // effective_status
  spend_today: number
  orders_today: number
  /** Lần tăng gần nhất HÔM NAY (null nếu chưa tăng hôm nay / đã lùi / đã reset) */
  step: null | { from: number; to: number; spend_at_step: number; minutes_ago: number; orders_since: number }
  minutes_since_last_action: number | null   // tăng/lùi gần nhất hôm nay
  reverted_today: boolean
  reset_done_today: boolean
  account_block: string | null
}

export type Decision =
  | { action: "tang" | "lui" | "reset"; to: number; reason: string }
  | { action: "none"; reason: string }

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`

// Phần chi tiêu cả ngày thường đã tiêu xong TRƯỚC mỗi mốc giờ (index = giờ VN), lấy từ
// hourly insights các camp XUANLT chạy đủ 24h (22, 27, 29/09). Camp tiêu gần nửa số tiền
// vào tối/đêm — nên so "đã tiêu ≥ 70% ngân sách" là quá muộn (thường tới tối mới chạm).
const DUONG_CHI_TIEU = [0, 0.02, 0.04, 0.055, 0.07, 0.085, 0.10, 0.14, 0.175, 0.205, 0.235, 0.27, 0.29,
  0.32, 0.34, 0.36, 0.40, 0.45, 0.525, 0.60, 0.68, 0.77, 0.86, 0.93, 1]

/** Ước chi tiêu cả ngày từ số đã tiêu tới hh:mm. */
export function projectDaySpend(spentSoFar: number, hour: number, minute: number): number {
  const h = Math.max(0, Math.min(23, hour))
  const share = DUONG_CHI_TIEU[h] + (DUONG_CHI_TIEU[h + 1] - DUONG_CHI_TIEU[h]) * (minute / 60)
  return spentSoFar / Math.max(share, 0.05)
}

export function decide(x: DecideInput): Decision {
  const { rule } = x
  if (!x.budget) return { action: "none", reason: "Camp không có ngân sách cấp campaign (ABO) — không hỗ trợ" }

  // 1. Reset đêm: từ 00:30 tới trước 6:00, mỗi camp 1 lần/ngày
  if (rule.nightly_reset && x.hour < 6 && (x.hour > 0 || x.minute >= 30)) {
    if (x.reset_done_today) return { action: "none", reason: "Đã reset đêm nay" }
    // Chỉ HẠ về mức nền. MKT chủ động hạ tay thấp hơn nền (camp xấu) thì giữ nguyên, không nâng lên.
    if (x.budget <= x.base) return { action: "reset", to: x.budget, reason: x.budget === x.base ? "Đã ở mức nền" : "Đang thấp hơn mức nền — giữ nguyên" }
    return { action: "reset", to: x.base, reason: "Reset đêm về mức nền" }
  }

  if (x.hour < rule.hour_from || x.hour >= rule.hour_to) {
    return { action: "none", reason: `Ngoài khung giờ ${rule.hour_from}h–${rule.hour_to}h` }
  }
  if (x.status !== "ACTIVE") return { action: "none", reason: `Camp đang ${x.status}` }

  // 2. Lùi — chỉ xét lần tăng của hôm nay, đã qua ≥ 60 phút, và ngân sách vẫn đúng mức đã tăng
  //    (MKT tự chỉnh tay thì không can thiệp).
  const s = x.step
  if (s && s.to === x.budget && s.minutes_ago >= 60) {
    const dSpend = x.spend_today - s.spend_at_step
    const nguong = rule.target_cpa * rule.revert_factor
    // 0 đơn: tiêu thêm quá ngưỡng là lùi. Đã có đơn: phải tiêu thêm ≥ 2× CPA mục tiêu mới đủ
    // mẫu để kết luận (replay 27/09: lùi lúc 18:45 với 1 đơn/327k là quá sớm — sau đó về thêm 2 đơn).
    const xau = s.orders_since === 0
      ? dSpend >= nguong
      : dSpend >= 2 * rule.target_cpa && dSpend / s.orders_since > nguong
    const to = Math.max(x.base, s.from)
    if (xau && to < x.budget) {
      return { action: "lui", to, reason: `Từ lần tăng: chi ${vnd(dSpend)}, ${s.orders_since} đơn (vượt ${vnd(nguong)}/đơn)` }
    }
  }

  // 3. Tăng
  const lyDo: string[] = []
  if (x.reverted_today) lyDo.push("hôm nay đã phải lùi — không tăng lại")
  const cpa = x.orders_today > 0 ? x.spend_today / x.orders_today : null
  if (x.orders_today < rule.min_orders) lyDo.push(`mới ${x.orders_today}/${rule.min_orders} đơn`)
  if (cpa === null || cpa > rule.target_cpa) lyDo.push(`CPA ${cpa === null ? "—" : vnd(cpa)} > ${vnd(rule.target_cpa)}`)
  // Nhịp tiêu: ước cả ngày theo đường chi tiêu chuẩn. spend_ratio = 1 nghĩa là "cứ đà này
  // sẽ tiêu hết ngân sách" → camp sắp chạm trần, tăng mới có tác dụng.
  const duKien = projectDaySpend(x.spend_today, x.hour, x.minute)
  if (duKien < rule.spend_ratio * x.budget) {
    lyDo.push(`nhịp tiêu chưa chạm trần (cả ngày dự kiến ${vnd(duKien)} < ${Math.round(rule.spend_ratio * 100)}% của ${vnd(x.budget)})`)
  }
  if (x.minutes_since_last_action !== null && x.minutes_since_last_action < rule.cooldown_min) {
    lyDo.push(`chờ ${rule.cooldown_min - x.minutes_since_last_action} phút nữa`)
  }
  const to = Math.min(Math.round((x.budget * rule.multiplier) / 1000) * 1000, rule.max_budget)
  if (to <= x.budget) lyDo.push(`đã chạm trần ${vnd(rule.max_budget)}`)
  if (!lyDo.length && x.account_block) lyDo.push(x.account_block)
  if (lyDo.length) return { action: "none", reason: `Chưa tăng: ${lyDo.join("; ")}` }

  return {
    action: "tang", to,
    reason: `Hôm nay ${x.orders_today} đơn, ${vnd(cpa!)}/đơn, đã tiêu ${vnd(x.spend_today)} — cứ đà này cả ngày ~${vnd(duKien)} (ngân sách ${vnd(x.budget)})`,
  }
}
