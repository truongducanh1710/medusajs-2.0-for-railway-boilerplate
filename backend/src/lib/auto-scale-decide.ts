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
  /**
   * Đẩy nhanh kiểu Xuân (ngày 80tr 12/07, 49tr 23/08): đơn về RẺ từ sáng → nhân ×3 mỗi ~60 phút
   * lên 7–10tr, không chờ camp tiêu gần hết ngân sách. 0/1 = tắt.
   */
  fast_multiplier?: number
  /** Đẩy nhanh khi CPA hôm nay ≤ tỉ lệ này × CPA mục tiêu (vd 0.5 → 100k với mục tiêu 200k) */
  fast_cpa_ratio?: number
  fast_cooldown_min?: number
  /** Không tăng nữa khi % chi phí cả MKT hôm nay > mức này (0 = bỏ qua) */
  scale_mkt_max_pct?: number
  /** Không tăng camp tạo quá số ngày này — bộ video đã mòn (0 = bỏ qua). Camp vẫn chạy mức nền + phanh như thường */
  scale_max_age_days?: number
  /** "Để thông": camp hôm nay đang tốt và ngân sách dưới mức này thì bỏ chặn tổng MKT + nhịp tiêu, chờ ≤ 60' (0 = tắt) */
  free_scale_below?: number
  /** Chế độ MỐC CỐ ĐỊNH (16/10/2026): chỉ tăng ở các giờ ladder_hours, mỗi mốc lên 1 nấc ladder_levels */
  ladder_mode?: boolean
  /** vd "9,12,17" */
  ladder_hours?: string
  /** vd "300000,1000000,3000000,6000000" */
  ladder_levels?: string
  /** Trần tổng chi CẢ MKT hôm nay: tăng mà vượt mức này thì không tăng (0 = bỏ qua) */
  ladder_spend_cap?: number
  /** Phanh ngày xấu — xét 24/7, theo số liệu CỦA RIÊNG HÔM NAY */
  pause_enabled?: boolean
  /** Hôm nay chi ≥ mức này mới xét (đủ mẫu) */
  pause_day_spend?: number
  /** % chi phí hôm nay (chi / doanh số) > mức này → tắt tới hết ngày. 0 đơn = vô cùng */
  pause_cost_pct?: number
  /** Sáng hôm sau tự bật lại camp hệ thống đã tắt */
  pause_resume?: boolean
  /** Xấu bao nhiêu ngày LIÊN TIẾP thì để tắt hẳn (không tự bật lại) */
  pause_max_streak?: number
  /** Camp mới tạo dưới số giờ này thì không phanh */
  pause_min_age_hours?: number
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
  /** Giờ hiện tại theo múi giờ TÀI KHOẢN (ADS329 +8 = giờ VN + 1) — dùng cho reset đêm */
  account_hour?: number
  /** Phút kể từ lần tăng gần nhất hôm nay — của hệ thống HOẶC người tăng tay (mỗi lần tăng = reset học) */
  last_raise_minutes_ago?: number | null
  account_block: string | null
  /** Chi tiêu cộng dồn hôm nay tại snapshot ~2 giờ trước (camp_hourly_snapshot). null = chưa có */
  spend_2h_ago?: number | null
  /** Số phút giữa snapshot đó và bây giờ */
  minutes_since_snapshot?: number | null
  /** Doanh số hôm nay (cod_amount đơn hợp lệ) */
  revenue_today?: number
  /** Tuổi camp theo created_time trên FB (giờ). null = không rõ → không phanh */
  camp_age_hours?: number | null
  /** Hệ thống đã tắt camp này HÔM NAY (người bật lại thì tôn trọng tới hết ngày) */
  paused_today?: boolean
  /** Hôm qua hệ thống tắt camp và sau đó không ai tự tắt/bật tay → được tự bật lại */
  auto_paused_yesterday?: boolean
  /** Số ngày liên tiếp (kết thúc hôm qua) hệ thống phải tắt camp này */
  pause_streak?: number
  /** Đã tự bật lại hôm nay */
  resumed_today?: boolean
  /** Video chính của camp đã hỏng (7 ngày cộng mọi camp: chi ≥ 300k mà 0 đơn hoặc > 50%) → lý do không bật lại. null = video còn tốt / chưa đủ dữ liệu */
  video_block?: string | null
  /** Ngân sách đang thấp hơn nền do CHÍNH hệ thống hạ (lỗ ngày) và không ai chỉnh tay sau đó → reset đêm nâng về nền */
  system_lowered?: boolean
  /** 7 ngày trước hôm nay của chính camp (chi, đơn hợp lệ, doanh số) — xét camp thắng */
  week?: { spend: number; orders: number; revenue: number } | null
  /** Nhìn tổng theo MKT (null = MKT chưa bật quản lý tổng) */
  portfolio?: Portfolio | null
}

/**
 * Quản lý tổng theo MKT: giữ % chi phí CẢ MKT trong ngày quanh mục tiêu (vd 25–27%).
 *  - Tổng đang tốt (≤ max_pct): camp lẽ ra bị phanh vẫn được chạy thêm nếu chưa quá tệ
 *    (≤ lenient_max_pct) và CTR hôm nay ≥ CTR 7 ngày của MKT — xem có ra thêm đơn không.
 *  - Tới giờ tỉa (trim_hour) hoặc tổng chi đạt trim_spend mà tổng > max_pct: mỗi vòng 15 phút
 *    tắt 1 camp xấu nhất (% chi phí hôm nay của camp > trim_camp_pct, vd 40%), dần dần chỉ còn camp tốt.
 */
export type Portfolio = {
  mkt: string
  pct: number | null          // % chi phí cả MKT hôm nay
  spend?: number | null       // tổng chi cả MKT hôm nay (đ)
  revenue?: number | null     // doanh số cả MKT hôm nay (đ) — tính lỗ ngày
  /** Bật chế độ ngày xấu + lớp lỗ ngày (env AUTO_SCALE_BAD_DAY ≠ off) */
  day_rules?: boolean
  max_pct: number
  lenient_max_pct: number
  trim_active: boolean
  trim_pick: boolean           // camp này là camp xấu nhất được chọn tỉa vòng này
  ctr: number | null           // CTR hôm nay của camp (%)
  ctr_base: number | null      // CTR 7 ngày của CHÍNH camp (%); camp chưa đủ dữ liệu thì dùng CTR 7 ngày của MKT
  cpc_ratio?: number | null    // CPC hôm nay ÷ CPC 7 ngày của chính camp
}

export type Decision =
  | { action: "tang" | "lui" | "reset"; to: number; reason: string }
  | { action: "tat"; reason: string; final: boolean }
  | { action: "bat"; to: number; reason: string }
  | { action: "none"; reason: string }

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`

/** Lý do tắt vì hết đà sau lần tăng — ngày đó vẫn có thể tốt nên không tính vào chuỗi ngày xấu. */
export const HET_DA_PREFIX = "Hết đà sau lần tăng"

/** Từ mức ngân sách này trở lên, mỗi lần tăng chỉ cộng tối đa BIG_STEP_ADD. */
const BIG_STEP_FROM = 3_000_000
const BIG_STEP_ADD = 3_000_000

// Phần chi tiêu cả ngày thường đã tiêu xong TRƯỚC mỗi mốc giờ (index = giờ VN), lấy từ
// hourly insights các camp XUANLT chạy đủ 24h (22, 27, 29/09). Camp tiêu gần nửa số tiền
// vào tối/đêm — nên so "đã tiêu ≥ 70% ngân sách" là quá muộn (thường tới tối mới chạm).
const DUONG_CHI_TIEU = [0, 0.02, 0.04, 0.055, 0.07, 0.085, 0.10, 0.14, 0.175, 0.205, 0.235, 0.27, 0.29,
  0.32, 0.34, 0.36, 0.40, 0.45, 0.525, 0.60, 0.68, 0.77, 0.86, 0.93, 1]

function shareAt(hour: number, minute: number): number {
  const h = Math.max(0, Math.min(23, hour))
  return DUONG_CHI_TIEU[h] + (DUONG_CHI_TIEU[h + 1] - DUONG_CHI_TIEU[h]) * (minute / 60)
}

/** Ước chi tiêu cả ngày từ số đã tiêu tới hh:mm. */
export function projectDaySpend(spentSoFar: number, hour: number, minute: number): number {
  return spentSoFar / Math.max(shareAt(hour, minute), 0.05)
}

/**
 * Ước chi tiêu cả ngày theo TỐC ĐỘ GẦN ĐÂY: phần còn lại của ngày tiêu với nhịp của mấy giờ vừa
 * qua (quy đổi theo đường chi tiêu). Bắt được camp đang chậm lại — vd 05/10 Ads342 hết hạn mức
 * từ 13h, camp gần như ngừng tiêu nhưng ước theo đường chuẩn vẫn ra ~730k nên vẫn bị tăng.
 */
export function projectFromRecent(spentNow: number, spentBefore: number, minutesAgo: number, hour: number, minute: number): number {
  const tNow = hour * 60 + minute
  const tBefore = Math.max(0, tNow - minutesAgo)
  const shareNow = shareAt(hour, minute)
  const shareBefore = shareAt(Math.floor(tBefore / 60), tBefore % 60)
  const dShare = shareNow - shareBefore
  if (dShare <= 0.005) return projectDaySpend(spentNow, hour, minute)
  const rate = Math.max(0, spentNow - spentBefore) / dShare   // tiền / 1 đơn vị "phần ngày"
  return spentNow + rate * (1 - shareNow)
}

/**
 * Phanh ngày xấu: hôm nay đã chi ≥ pause_day_spend mà % chi phí HÔM NAY > pause_cost_pct → tắt tới hết ngày.
 * Hôm qua tốt cũng không cứu được hôm nay — ngày tốt thì tự scale tăng ga, ngày xấu thì phanh.
 *
 * Ngưỡng 300k / 45% / bật lại sáng hôm sau / tắt hẳn sau 3 ngày xấu liền chọn bằng mô phỏng
 * 26/09–07/10 (camp XUANLT + ANHTD): lời ròng tốt nhất. Tắt HẲN ngay ngày xấu đầu tiên thì mất
 * camp thắng (23/9 S1: ngày 26/09 chi 549k 0 đơn, sau đó chạy 7tr ở 27%).
 */
/**
 * Camp THẮNG (tạo ≥ 7 ngày, 7 ngày trước hôm nay ≥ 5 đơn và ≤ 28%) thì ngưỡng phanh sáng + mốc 13h
 * nâng lên 300k (25/10/2026 user): S1 VD131–134 ADS344 (tuần 18%) bị tắt 10:02 lúc 201k 0 đơn, đơn về
 * sau đó → XUANLT cả ngày chỉ chi 2tr. Camp khác (kể cả camp cũ mà tuần > 28%) vẫn giữ 200k / 150k.
 */
export const VETERAN_AGE_HOURS = 7 * 24
// 2/11/2026 (user duyệt): các mốc tiền cố định trước đây (300k / 150k / 60k) chỉnh cho chảo vàng (đơn ~920k)
// → hộp nhựa (~600k) bị cắt muộn hơn tương đối. Giờ tỉ lệ theo bộ điều kiện; bộ chảo vàng (phanh 200k, CPA mục tiêu
// 200k) ra đúng số cũ. Backtest 0 đơn: hộp nhựa chạm 130k → 5% ngày kết thúc ≤28% ~ chảo vàng chạm 200k → 4%.
const pauseBase = (r: DecideRule) => Number(r.pause_day_spend || 0) || 200_000
/** Camp thắng: phanh sáng + mốc 13h = 1,5 × mốc phanh của bộ (chảo vàng 300k) */
export const veteranMinSpend = (r: DecideRule) => Math.round(1.5 * pauseBase(r))
/** Mốc 13h 0 đơn = 0,75 × mốc phanh của bộ (chảo vàng 150k) */
const noonCutSpend = (r: DecideRule) => Math.round(0.75 * pauseBase(r))
/** Nhảy nấc khi CPA ≤ 0,3 × CPA mục tiêu của bộ (chảo vàng 60k) */
const jumpCpa = (r: DecideRule) => Math.round(0.3 * (Number(r.target_cpa || 0) || 200_000))
export const VETERAN_MIN_ORDERS = 5
export const VETERAN_MAX_PCT = 28
export const isVeteran = (x: DecideInput) => {
  const w = x.week
  return x.camp_age_hours != null && x.camp_age_hours >= VETERAN_AGE_HOURS && !!w
    && w.orders >= VETERAN_MIN_ORDERS && w.revenue > 0 && (w.spend / w.revenue) * 100 <= VETERAN_MAX_PCT
}

export function pauseReason(x: DecideInput): string | null {
  const r = x.rule
  if (!r.pause_enabled || x.paused_today) return null
  const minAge = r.pause_min_age_hours ?? 0
  if (minAge > 0 && (x.camp_age_hours === null || x.camp_age_hours === undefined || x.camp_age_hours < minAge)) return null
  const minSpend = isVeteran(x) ? veteranMinSpend(r) : Number(r.pause_day_spend || 0)
  const maxPct = Number(r.pause_cost_pct || 0)
  if (!minSpend || !maxPct || x.spend_today < minSpend) return null
  const rev = Number(x.revenue_today || 0)
  const pct = rev > 0 ? (x.spend_today / rev) * 100 : Infinity
  if (pct <= maxPct) return null
  return `Hôm nay chi ${vnd(x.spend_today)}, ${x.orders_today} đơn, doanh số ${vnd(rev)} → ${Number.isFinite(pct) ? `${pct.toFixed(0)}%` : "chưa có doanh số"} > ${maxPct}%`
}

export const RESUME_FROM_HOUR = 5

/**
 * Chế độ MỐC CỐ ĐỊNH (quy trình chảo vàng chốt 16/10/2026, phân tích 2.709 camp-ngày 04–10/2026).
 * Đơn về tốt nhất 6–7h, 14h, 18h, 20–22h; tăng liên tục mỗi 15' (27 lần 08–16/10) chỉ ra 32%, bước ×3 ra 53%.
 *  - Tăng CHỈ trong KHUNG ladder_hours — mỗi giờ trong danh sách là 1 khung trọn 1 tiếng (19/10/2026 user: 9h–10h,
 *    12h–13h, 16h–17h thay vì 30' đầu giờ của 9h/12h/17h), mỗi khung lên tối đa 1 nấc → tối đa 3 lần/ngày.
 *    Nấc đầu (nền → nấc 2): hôm nay ≥ 3 đơn, ≤ 25%, CPA ≤ min(150k, mục tiêu) (4/11/2026: trước là ≥ 2 đơn).
 *    Nấc sau: % chi phí hôm nay ≤ 25% và ≥ 2 đơn MỚI từ lần tăng trước; lên nấc cuối cần ≥ 5 đơn hôm nay.
 *  - Tắt (ngoài phanh ngày xấu chung): từ 13h camp 0 đơn mà đã chi ≥ 150k (để chạy thì phần sau 52%);
 *    ở mốc 12h/16h/21h (30' đầu giờ) camp đã tăng ≥ 60' mà chi thêm ≥ 1/3 phần vừa tăng, 0 đơn mới → tắt tới hết ngày.
 */
const LADDER_FIRST_CPA = 150_000
const LADDER_FIRST_ORDERS = 3
const LADDER_MAX_PCT = 25
const LADDER_TOP_ORDERS = 5
const LADDER_CHECK_HOURS = [12, 16, 21]
const LADDER_NOON_CUT_HOUR = 13
// 30/10/2026 (user duyệt): khung tăng 12h siết — tiền tăng lúc 12h chảy vào 13–18h (giờ xấu 36–48%);
// 134 lần tăng tháng 10: phần chi sau mốc 9h 27%, 12h 32%, 16h 30%. Chỉ tăng ở 12h khi ≥ 3 đơn và ≤ 22%.
const LADDER_STRICT_HOUR = 12
const LADDER_STRICT_ORDERS = 3
const LADDER_STRICT_PCT = 22
// 20/10/2026 user: mỗi lần tăng (tay hay hệ thống) là 1 lần reset học → lần sau cách ≥ 3 tiếng.
const RAISE_GAP_MIN = 180
const LADDER_JUMP_ORDERS = 5

/**
 * CHẾ ĐỘ NGÀY XẤU (4/11/2026, user duyệt — KINH_NGHIEM mục 18–19, _ngayxau.mjs / _xautot.mjs / _lo3tr.mjs).
 * Thay mốc cũ "từ 16h tổng ≥ 10tr & > 35% thì không tăng" và trần cứng 12tr (trần chưa từng chặn lần tăng nào).
 *  - Từ 12h, cả MKT (gộp bàn giao XUANLT+ANHTD) đã chi ≥ 1,5tr và % hôm nay > 30% → ngày xấu:
 *    camp 0 đơn đã chi ≥ ½ mốc phanh của bộ (chảo vàng 100k) hoặc camp > 35% → tắt tới hết ngày.
 *    Ngày xấu lúc 11h: camp 0 đơn ≥100k phần sau 45% (ngày ổn 32–38%) → tiền cắt ra biên 60–106%.
 *  - Camp 1–2 đơn giữ nguyên; camp ≥ 3 đơn ≤ 25% vẫn leo thang (ngày xấu tăng ra 29–30%, ngang ngày ổn).
 *  - Lỗ ngày = chi − 28% × doanh số cả MKT. Chạm 2tr → hạ 50% mọi camp (1 lần/ngày) trừ camp ≥ 3 đơn ≤ 25%;
 *    chạm 3tr (mức user chấp nhận cho 1 ngày xấu) → không tăng thêm camp nào.
 */
export const BAD_DAY_FROM_HOUR = 12
export const BAD_DAY_MIN_SPEND = 1_500_000
export const BAD_DAY_PCT = 30
const BAD_DAY_CAMP_PCT = 35
export const LOSS_TARGET_PCT = 28
export const LOSS_HALVE = 2_000_000
export const LOSS_STOP_RAISE = 3_000_000
export const BAD_DAY_PREFIX = "NGÀY XẤU"
export const LOSS_PREFIX = "LỖ NGÀY"
const GOOD_ORDERS = 3
const GOOD_PCT = 25
// Camp lên chưa đủ 24h (ngày học đầu tiên) không bị chế độ ngày xấu / lỗ ngày đụng — phanh thường (> 45%) vẫn áp.
// 4/11: user chấp nhận chi phí ngày lên camp để lấy đà; _rulestress: 9/27 lần cắt rơi đúng ngày 1.
const BAD_DAY_MIN_AGE_HOURS = 24

/** Trạng thái cả ngày của MKT: ngày xấu? lỗ bao nhiêu? (hàm thuần — dùng chung cho decide và nhật ký ngày) */
export function dayMode(hour: number, spend: number | null | undefined, revenue: number | null | undefined) {
  const s = Number(spend || 0), r = Number(revenue || 0)
  const pct = r > 0 ? (s / r) * 100 : s > 0 ? Infinity : null
  const loss = s - (LOSS_TARGET_PCT / 100) * r
  const bad = hour >= BAD_DAY_FROM_HOUR && s >= BAD_DAY_MIN_SPEND && pct !== null && pct > BAD_DAY_PCT
  return { bad, loss, pct, halve: loss >= LOSS_HALVE, stop_raise: loss >= LOSS_STOP_RAISE }
}
const fmtPct = (p: number | null) => (p === null ? "—" : Number.isFinite(p) ? `${p.toFixed(0)}%` : "chưa có doanh số")

const parseNums = (s: string | undefined, def: number[]) => {
  const v = String(s || "").split(",").map((t) => Number(t.trim())).filter((n) => Number.isFinite(n) && n > 0)
  return v.length ? v : def
}

function decideLadder(x: DecideInput): Decision {
  const { rule } = x
  const hours = parseNums(rule.ladder_hours, [9, 12, 16])
  const levels = parseNums(rule.ladder_levels, [300_000, 1_000_000, 3_000_000, 6_000_000]).sort((a, b) => a - b)
  const inCheck = (hs: number[]) => hs.includes(x.hour) && x.minute < 30
  const inRaiseWindow = hours.includes(x.hour)
  const rev = Number(x.revenue_today || 0)
  const pct = rev > 0 ? (x.spend_today / rev) * 100 : Infinity
  const cpa = x.orders_today > 0 ? x.spend_today / x.orders_today : null
  const s = x.step

  if (!x.paused_today) {
    if (x.hour >= LADDER_NOON_CUT_HOUR && x.orders_today === 0 && x.spend_today >= (isVeteran(x) ? veteranMinSpend(rule) : noonCutSpend(rule))) {
      return { action: "tat", final: false, reason: `Mốc ${LADDER_NOON_CUT_HOUR}h: chi ${vnd(x.spend_today)}, 0 đơn — tắt tới hết ngày, 5h sáng mai bật lại mức nền` }
    }
    if (s && s.to === x.budget && inCheck(LADDER_CHECK_HOURS) && s.minutes_ago >= 60 && s.orders_since === 0) {
      const dSpend = x.spend_today - s.spend_at_step
      if (dSpend >= (s.to - s.from) / 3) {
        return {
          action: "tat", final: false,
          reason: `${HET_DA_PREFIX} ${vnd(s.from)} → ${vnd(s.to)}: chi thêm ${vnd(dSpend)}, 0 đơn mới (mốc ${x.hour}h) — tắt tới hết ngày, 5h sáng mai bật lại mức nền`,
        }
      }
    }
  }

  if (!inRaiseWindow) return { action: "none", reason: `Chờ khung tăng ${hours.map((h) => `${h}h–${h + 1}h`).join(" / ")}` }
  // 1 nấc/khung: đã tăng trong chính giờ này thì thôi (step_at nằm trong khung hiện tại)
  if (s && s.minutes_ago <= x.minute) return { action: "none", reason: `Khung ${x.hour}h–${x.hour + 1}h đã tăng 1 nấc` }
  if (x.last_raise_minutes_ago != null && x.last_raise_minutes_ago < RAISE_GAP_MIN) {
    return { action: "none", reason: `Vừa tăng ${x.last_raise_minutes_ago} phút trước — chờ đủ ${RAISE_GAP_MIN / 60} tiếng giữa 2 lần tăng` }
  }
  let idx = 0
  for (let i = 0; i < levels.length; i++) if (x.budget >= levels[i] * 0.999) idx = i
  // Nhảy nấc (user duyệt 20/10/2026): nấc đầu mà camp đã ≥ 5 đơn và ≤ 60k/đơn → lên thẳng nấc 3 (300k → 3tr).
  // 205 lần tăng của Xuân 21/6–7/10: có ≥5 đơn thì lần nào cũng nhảy 2–5tr, phần sau tăng 20% (2–4 đơn lên 1tr: 26%).
  const jump = idx === 0 && x.orders_today >= LADDER_JUMP_ORDERS && cpa !== null && cpa <= jumpCpa(rule) && levels.length > 2
  const to = Math.min((jump ? levels[2] : levels[idx + 1]) ?? 0, rule.max_budget)
  if (!to || to <= x.budget) return { action: "none", reason: `Đã ở nấc cao nhất ${vnd(x.budget)}` }

  const lyDo: string[] = []
  if (idx === 0) {
    // 4/11/2026 (user duyệt, _intraday.mjs 1/7–3/11): nấc đầu ở MỌI khung cần ≥ 3 đơn & ≤ 25%.
    // 2 đơn ≤25% lúc 11h: giữ ngân sách phần còn lại 30%, tăng 34%; ≥3 đơn: 24–26% → chỉ ≥3 đơn là tín hiệu thật.
    const firstCpa = Math.min(LADDER_FIRST_CPA, rule.target_cpa)
    if (x.orders_today < LADDER_FIRST_ORDERS) lyDo.push(`mới ${x.orders_today}/${LADDER_FIRST_ORDERS} đơn`)
    else if (cpa! > firstCpa) lyDo.push(`${vnd(cpa!)}/đơn > ${vnd(firstCpa)}`)
    else if (!(pct <= LADDER_MAX_PCT)) lyDo.push(`hôm nay ${Number.isFinite(pct) ? pct.toFixed(0) + "%" : "chưa có doanh số"} > ${LADDER_MAX_PCT}%`)
  } else {
    // Ngân sách đang ở nấc trên mà KHÔNG do hệ thống tăng hôm nay (người nâng tay) → không tự tăng tiếp.
    // 17/10: 3 camp bị nâng tay lên 1tr, hệ thống coi 2 đơn cả ngày là "2 đơn mới" và nhảy 3tr
    // (REVIVE VD9101112 sau đó tiêu thêm 631k, 0 đơn). Phanh / hết đà vẫn áp như thường.
    if (!s || s.to !== x.budget) return { action: "none", reason: `Ngân sách ${vnd(x.budget)} đặt tay (không phải nấc hệ thống tăng hôm nay) — không tự tăng tiếp` }
    const moi = s.orders_since
    if (pct > LADDER_MAX_PCT) lyDo.push(`hôm nay ${Number.isFinite(pct) ? pct.toFixed(0) + "%" : "chưa có doanh số"} > ${LADDER_MAX_PCT}%`)
    if (moi < 2) lyDo.push(`mới ${moi}/2 đơn từ lần tăng trước`)
    if (idx + 1 === levels.length - 1 && x.orders_today < LADDER_TOP_ORDERS) lyDo.push(`lên nấc cuối cần ≥ ${LADDER_TOP_ORDERS} đơn (đang ${x.orders_today})`)
  }
  if (x.hour === LADDER_STRICT_HOUR) {
    if (x.orders_today < LADDER_STRICT_ORDERS) lyDo.push(`khung ${LADDER_STRICT_HOUR}h cần ≥ ${LADDER_STRICT_ORDERS} đơn (đang ${x.orders_today}) — chờ 16h`)
    else if (!(pct <= LADDER_STRICT_PCT)) lyDo.push(`khung ${LADDER_STRICT_HOUR}h cần ≤ ${LADDER_STRICT_PCT}% (đang ${Number.isFinite(pct) ? pct.toFixed(0) + "%" : "—"}) — chờ 16h`)
  }
  // 4/11/2026: bỏ mốc "từ 16h ≥ 10tr & > 35%" — thay bằng chế độ ngày xấu (camp ≥ 3 đơn ≤ 25% vẫn tăng ngày xấu).
  // Lỗ ngày chạm 3tr (mức user chấp nhận) → không tăng thêm camp nào.
  const pf = x.portfolio
  if (pf?.day_rules) {
    const dm = dayMode(x.hour, pf.spend, pf.revenue)
    if (dm.stop_raise) lyDo.push(`${LOSS_PREFIX} ${pf.mkt} đã ${vnd(dm.loss)} ≥ ${vnd(LOSS_STOP_RAISE)} — không tăng thêm`)
  }
  // Trần an toàn tổng chi theo MKT (17/10: 12tr; 4/11: 20tr — chỉ chống lỗi, % do chế độ ngày xấu giữ).
  const cap = Number(rule.ladder_spend_cap || 0)
  const mktSpend = x.portfolio?.spend
  if (cap > 0 && mktSpend != null && mktSpend + (to - x.budget) > cap) {
    lyDo.push(`tổng chi ${x.portfolio!.mkt} hôm nay ${vnd(mktSpend)} + phần tăng ${vnd(to - x.budget)} > trần ${vnd(cap)}`)
  }
  if (!lyDo.length && x.account_block) lyDo.push(x.account_block)
  if (lyDo.length) return { action: "none", reason: `Mốc ${x.hour}h chưa tăng: ${lyDo.join("; ")}` }
  return {
    action: "tang", to,
    reason: `${jump ? "NHẢY NẤC" : "MỐC"} ${x.hour}h: ${vnd(x.budget)} → ${vnd(to)} — hôm nay ${x.orders_today} đơn, ${vnd(cpa!)}/đơn, ${Number.isFinite(pct) ? pct.toFixed(0) + "%" : "—"}`,
  }
}

export function decide(x: DecideInput): Decision {
  const { rule } = x
  if (!x.budget) return { action: "none", reason: "Camp không có ngân sách cấp campaign (ABO) — không hỗ trợ" }

  // 1. Reset đêm: ngay sau 0h (lượt chạy 0h00–0h15) tới trước 6:00, mỗi camp 1 lần/ngày.
  //    19/10/2026 user: trước đây từ 0h30 → 30' đầu ngày camp vẫn giữ ngân sách to của hôm trước.
  //    Tính theo giờ của TÀI KHOẢN: ADS329 (+8) về nền lúc 23h giờ VN = 0h ngày mới của FB.
  const resetHour = x.account_hour ?? x.hour
  if (rule.nightly_reset && resetHour < 6 && !x.reset_done_today) {
    // Chỉ HẠ về mức nền. MKT chủ động hạ tay thấp hơn nền (camp xấu) thì giữ nguyên, không nâng lên.
    // Ngoại lệ: chính hệ thống hạ hôm trước (lỗ ngày) → nâng lại nền.
    if (x.budget < x.base && x.system_lowered) return { action: "reset", to: x.base, reason: `Reset đêm: hôm qua hệ thống hạ (${LOSS_PREFIX}) → về lại mức nền` }
    if (x.budget <= x.base) return { action: "reset", to: x.budget, reason: x.budget === x.base ? "Đã ở mức nền" : "Đang thấp hơn mức nền — giữ nguyên" }
    return { action: "reset", to: x.base, reason: "Reset đêm về mức nền" }
  }

  // 2. Ngày mới: bật lại camp hôm qua bị phanh (sau khi đã reset về mức nền).
  //    16/10/2026: bật từ 5h (giờ chuẩn lên camp của Xuân) thay vì 0h30 — bật đêm thì camp tiêu
  //    cả đêm trước khung vàng 6–8h. Cửa sổ tới 8h để job trễ vẫn kịp bật.
  if (x.status === "PAUSED" && rule.pause_enabled && rule.pause_resume && x.auto_paused_yesterday && !x.resumed_today
      && x.hour >= RESUME_FROM_HOUR && x.hour < RESUME_FROM_HOUR + 3) {
    const max = rule.pause_max_streak ?? 3
    if ((x.pause_streak ?? 0) >= max) return { action: "none", reason: `Xấu ${x.pause_streak} ngày liền — để tắt hẳn, chờ người quyết` }
    // 4/11/2026 (user duyệt, _ts10.mjs): bật lại camp chạy video đã hỏng ra 45% (video test chưa đủ dữ liệu thì
    // vẫn bật — luật vòng đời video tự cắt ở mốc 300k/800k). Camp xấu mà video còn tốt thì bật lại vẫn 31–33%.
    if (x.video_block) return { action: "none", reason: `Không bật lại: ${x.video_block}` }
    return { action: "bat", to: x.base, reason: `Ngày mới — bật lại sau khi hôm qua bị phanh (${x.pause_streak} ngày xấu liền)` }
  }

  if (x.status !== "ACTIVE") return { action: "none", reason: `Camp đang ${x.status}` }

  // 3. Phanh ngày xấu — chạy mọi giờ (camp tiêu ~40% tiền sau 19h, không ai canh)
  const final = !rule.pause_resume || (x.pause_streak ?? 0) + 1 >= (rule.pause_max_streak ?? 3)
  const pf = x.portfolio
  const tat = pauseReason(x)
  if (tat) {
    const rev = Number(x.revenue_today || 0)
    const campPct = rev > 0 ? (x.spend_today / rev) * 100 : Infinity
    // Phân tích 01/09–09/10: so với CHÍNH camp mới có tín hiệu (so với MKT thì không); CPC > 1,1× thường ngày
    // là ngày xấu nhiều hơn. CTR cao bất thường không tốt hơn nên chỉ đòi CTR không tụt.
    const ctrOk = pf?.ctr != null && pf.ctr_base != null && pf.ctr >= pf.ctr_base
      && (pf.cpc_ratio == null || pf.cpc_ratio <= 1.1)
    if (pf && !pf.trim_active && pf.pct !== null && pf.pct <= pf.max_pct && campPct <= pf.lenient_max_pct && ctrOk) {
      return {
        action: "none",
        reason: `Giữ chạy thêm: ${tat} — nhưng tổng ${pf.mkt} hôm nay ${pf.pct}% ≤ ${pf.max_pct}%, CTR ${pf.ctr!.toFixed(2)}% ≥ ${pf.ctr_base!.toFixed(2)}% (7 ngày của camp)${pf.cpc_ratio != null ? `, CPC ${pf.cpc_ratio.toFixed(2)}× thường ngày` : ""}`,
      }
    }
    return { action: "tat", reason: pf?.trim_active ? `${tat} (đang giờ tỉa, tổng ${pf.mkt} ${pf.pct ?? "—"}%)` : tat, final }
  }
  if (pf?.trim_pick) {
    const rev = Number(x.revenue_today || 0)
    const campPct = rev > 0 ? `${((x.spend_today / rev) * 100).toFixed(0)}%` : "chưa có doanh số"
    return {
      action: "tat", final,
      reason: `Tỉa: tổng ${pf.mkt} hôm nay ${pf.pct}% > ${pf.max_pct}% — camp xấu nhất (chi ${vnd(x.spend_today)}, ${x.orders_today} đơn, ${campPct})`,
    }
  }

  // 3b. Chế độ ngày xấu + lỗ ngày — chỉ bộ chạy thang (bộ TEST #7 do vòng đời video lo), mọi giờ từ 12h
  const young = x.camp_age_hours != null && x.camp_age_hours < BAD_DAY_MIN_AGE_HOURS
  if (pf?.day_rules && rule.ladder_mode && rule.pause_enabled && !x.paused_today && !young) {
    const dm = dayMode(x.hour, pf.spend, pf.revenue)
    const rev = Number(x.revenue_today || 0)
    const campPct = rev > 0 ? (x.spend_today / rev) * 100 : Infinity
    const good = x.orders_today >= GOOD_ORDERS && campPct <= GOOD_PCT
    const tong = `tổng ${pf.mkt} chi ${vnd(Number(pf.spend || 0))}, ${fmtPct(dm.pct)}, lỗ ${vnd(dm.loss)}`
    if (dm.bad && !good) {
      // camp thắng 7 ngày (isVeteran) được nới tới đúng mốc phanh của bộ
      const minSpend = isVeteran(x) ? pauseBase(rule) : Math.round(0.5 * pauseBase(rule))
      if (x.spend_today >= minSpend && (x.orders_today === 0 || campPct > BAD_DAY_CAMP_PCT)) {
        return {
          action: "tat", final,
          reason: `${BAD_DAY_PREFIX} (${tong} > ${BAD_DAY_PCT}%): camp chi ${vnd(x.spend_today)}, ${x.orders_today} đơn, ${fmtPct(campPct)} — tắt tới hết ngày`,
        }
      }
    }
    if (dm.halve && !good && !x.reverted_today && x.budget > 100_000) {
      const to = Math.max(50_000, Math.round(x.budget / 2 / 1000) * 1000)
      return {
        action: "lui", to,
        reason: `${LOSS_PREFIX} ≥ ${vnd(LOSS_HALVE)} (${tong}): hạ 50% ${vnd(x.budget)} → ${vnd(to)} — camp ${x.orders_today} đơn, ${fmtPct(campPct)}; 0h về lại nền`,
      }
    }
  }

  // 4. Hết đà sau lần tăng → TẮT tới hết ngày (thay cho "lùi" từ 14/10/2026) — chạy mọi giờ
  //    (06/10: tăng lên 2tr lúc 16h30, sau đó tiêu thêm ~760k, 0 đơn — trước đây hết khung 19h là bỏ mặc).
  //    5 lần lùi thật 08–13/10: sau khi lùi camp tiêu thêm 1,94tr, 4 đơn, 61% → lùi chỉ kéo dài phần xấu.
  //    Chỉ xét lần tăng của hôm nay, đã qua ≥ 60 phút, và ngân sách vẫn đúng mức đã tăng
  //    (MKT tự chỉnh tay thì không can thiệp). Người bật lại sau khi đã tắt hôm nay thì tôn trọng.
  //    Sáng hôm sau tự bật lại ở mức nền; KHÔNG tính vào chuỗi ngày xấu (xem HET_DA_PREFIX).
  const s = x.step
  if (!rule.ladder_mode && s && s.to === x.budget && s.minutes_ago >= 60 && !x.paused_today) {
    const dSpend = x.spend_today - s.spend_at_step
    const nguong = rule.target_cpa * rule.revert_factor
    // 0 đơn: tiêu thêm quá ngưỡng là lùi. Đã có đơn: phải tiêu thêm ≥ 2× CPA mục tiêu mới đủ
    // mẫu để kết luận (replay 27/09: lùi lúc 18:45 với 1 đơn/327k là quá sớm — sau đó về thêm 2 đơn).
    const xau = s.orders_since === 0
      ? dSpend >= nguong
      : dSpend >= 2 * rule.target_cpa && dSpend / s.orders_since > nguong
    if (xau) {
      return {
        action: "tat", final: false,
        reason: `${HET_DA_PREFIX} ${vnd(s.from)} → ${vnd(s.to)}: chi thêm ${vnd(dSpend)}, ${s.orders_since} đơn (vượt ${vnd(nguong)}/đơn) — tắt tới hết ngày, sáng mai bật lại mức nền`,
      }
    }
  }

  if (rule.ladder_mode) return decideLadder(x)

  if (x.hour < rule.hour_from || x.hour >= rule.hour_to) {
    return { action: "none", reason: `Ngoài khung giờ ${rule.hour_from}h–${rule.hour_to}h` }
  }

  // 5. Tăng
  const lyDo: string[] = []
  if (x.reverted_today) lyDo.push("hôm nay đã phải lùi — không tăng lại")
  const cpa = x.orders_today > 0 ? x.spend_today / x.orders_today : null
  if (x.orders_today < rule.min_orders) lyDo.push(`mới ${x.orders_today}/${rule.min_orders} đơn`)
  if (cpa === null || cpa > rule.target_cpa) lyDo.push(`CPA ${cpa === null ? "—" : vnd(cpa)} > ${vnd(rule.target_cpa)}`)
  const fastMul = Number(rule.fast_multiplier || 0)
  const fast = fastMul > 1 && cpa !== null && x.orders_today >= rule.min_orders
    && cpa <= rule.target_cpa * Number(rule.fast_cpa_ratio ?? 0.5)
  // 16/10/2026: 8 lần tăng camp > 14 ngày (15/9, 19/9, 11/9) 06–15/10 tiêu thêm 4,8tr, 9 đơn (~59%).
  // Mô phỏng theo giờ 20/09–15/10: phần chi sau điểm tăng ở camp > 14 ngày 25–30% vs ≤ 14 ngày 17–28%.
  const maxAge = Number(rule.scale_max_age_days || 0)
  if (maxAge > 0 && x.camp_age_hours != null && x.camp_age_hours > maxAge * 24) {
    lyDo.push(`camp đã ${Math.floor(x.camp_age_hours / 24)} ngày > ${maxAge} ngày — chỉ chạy mức nền, không tăng`)
  }
  // "Để thông": camp HÔM NAY đang tốt (đủ đơn, CPA ≤ mục tiêu) và ngân sách dưới mức này thì không
  // chặn vì tổng MKT / nhịp tiêu, chờ ngắn hơn. Replay 01–15/10: 43 lần camp Xuân đang tốt dưới 2tr
  // mà không được tăng — phần còn lại của ngày vẫn ra 22% nhưng chỉ tiêu thêm ~400k vì chạm trần.
  const thongDuoi = Number(rule.free_scale_below || 0)
  const thong = thongDuoi > 0 && x.budget < thongDuoi && cpa !== null
    && x.orders_today >= rule.min_orders && cpa <= rule.target_cpa
  const mktMax = Number(rule.scale_mkt_max_pct || 0)
  if (!thong && mktMax > 0 && x.portfolio?.pct != null && x.portfolio.pct > mktMax) {
    lyDo.push(`tổng ${x.portfolio.mkt} hôm nay ${x.portfolio.pct}% > ${mktMax}% — không đẩy thêm`)
  }
  // Nhịp tiêu: ước cả ngày theo đường chi tiêu chuẩn. spend_ratio = 1 nghĩa là "cứ đà này
  // sẽ tiêu hết ngân sách" → camp sắp chạm trần, tăng mới có tác dụng.
  // Đẩy nhanh bỏ qua điều kiện này: Xuân đẩy TRƯỚC để camp có sẵn tiền tiêu chiều/tối.
  const duKien = projectDaySpend(x.spend_today, x.hour, x.minute)
  if (fast || thong) {
    // không xét nhịp tiêu
  } else if (duKien < rule.spend_ratio * x.budget) {
    lyDo.push(`nhịp tiêu chưa chạm trần (cả ngày dự kiến ${vnd(duKien)} < ${Math.round(rule.spend_ratio * 100)}% của ${vnd(x.budget)})`)
  } else if (x.spend_2h_ago != null && x.minutes_since_snapshot && x.minutes_since_snapshot >= 45
    && x.spend_today < 0.9 * x.budget) {   // ≥ 90% ngân sách = chậm lại vì chạm trần → đúng lúc tăng
    // Cả tốc độ gần đây cũng phải cho thấy camp sắp chạm trần
    const duKienGanDay = projectFromRecent(x.spend_today, x.spend_2h_ago, x.minutes_since_snapshot, x.hour, x.minute)
    if (duKienGanDay < rule.spend_ratio * x.budget) {
      lyDo.push(`đang tiêu chậm lại (theo ${x.minutes_since_snapshot} phút gần nhất cả ngày chỉ ~${vnd(duKienGanDay)} < ${vnd(x.budget)})`)
    }
  }
  // Từ lần tăng thứ 2 trong ngày: phải có đơn MỚI sau lần tăng trước, và phần tiêu thêm đạt CPA.
  // 05/10: S1/S2 bị tăng lần 2 lúc 12:30 chỉ nhờ 2 đơn ban đêm đã dùng cho lần tăng lúc 9h.
  if (s && s.to === x.budget) {
    const dSpend = Math.max(0, x.spend_today - s.spend_at_step)
    if (s.orders_since < 1) lyDo.push("chưa có đơn mới từ lần tăng trước")
    else if (dSpend / s.orders_since > rule.target_cpa) lyDo.push(`từ lần tăng trước ${vnd(dSpend / s.orders_since)}/đơn > ${vnd(rule.target_cpa)}`)
  }
  const cooldown = fast ? Number(rule.fast_cooldown_min || 60) : thong ? Math.min(rule.cooldown_min, 60) : rule.cooldown_min
  if (x.minutes_since_last_action !== null && x.minutes_since_last_action < cooldown) {
    lyDo.push(`chờ ${cooldown - x.minutes_since_last_action} phút nữa`)
  }
  // Bậc thang: dưới 3tr nhân như cũ nhưng dừng ở 3tr (300k → 900k → 2,7tr → 3tr); từ 3tr trở lên
  // chỉ cộng 3tr/bước (3tr → 6tr → 9tr). 13/10 nhảy 3tr → 9tr một phát, camp hết đà ngay sau đó.
  const nhan = Math.round((x.budget * (fast ? fastMul : rule.multiplier)) / 1000) * 1000
  const bac = x.budget < BIG_STEP_FROM ? Math.min(nhan, BIG_STEP_FROM) : Math.min(nhan, x.budget + BIG_STEP_ADD)
  const to = Math.min(bac, rule.max_budget)
  if (to <= x.budget) lyDo.push(`đã chạm trần ${vnd(rule.max_budget)}`)
  if (!lyDo.length && x.account_block) lyDo.push(x.account_block)
  if (lyDo.length) return { action: "none", reason: `Chưa tăng: ${lyDo.join("; ")}` }

  return {
    action: "tang", to,
    reason: fast
      ? `ĐẨY NHANH → ${vnd(to)}: hôm nay ${x.orders_today} đơn, ${vnd(cpa!)}/đơn (≤ ${vnd(rule.target_cpa * Number(rule.fast_cpa_ratio ?? 0.5))}), đã tiêu ${vnd(x.spend_today)}`
      : `${thong ? `ĐỂ THÔNG (< ${vnd(thongDuoi)}): ` : ""}Hôm nay ${x.orders_today} đơn, ${vnd(cpa!)}/đơn, đã tiêu ${vnd(x.spend_today)} — cứ đà này cả ngày ~${vnd(duKien)} (ngân sách ${vnd(x.budget)})`,
  }
}
