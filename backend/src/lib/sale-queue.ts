// Shared helpers for the sale call queue (/app/xac-nhan-don redesign).
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "./constants"

/**
 * Pancake POS call for the VN shop. Write endpoints verified on TEST order #96040:
 * create_note needs customer.customer_id (not customer.id); order discount must be sent as
 * `discount` — `total_discount` in a PUT is silently ignored.
 */
export async function pos(method: "GET" | "POST" | "PUT", path: string, body?: any): Promise<any> {
  const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}${path}${path.includes("?") ? "&" : "?"}api_key=${PANCAKE_API_KEY}`
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  if (!res.ok || json?.success === false) {
    throw new Error(`POS ${method} ${path.split("?")[0]} → ${res.status}: ${(json?.message ?? text).toString().slice(0, 200)}`)
  }
  return json
}

export type PosTag = { id: number; name: string; system: boolean }
let tagCache: { at: number; list: PosTag[] } | null = null

/** Shop order tags (cached 1h). System tags (vận chuyển, đối soát...) are POS-managed — never touched by the queue. */
export async function getPosTags(): Promise<PosTag[]> {
  if (tagCache && Date.now() - tagCache.at < 3600_000) return tagCache.list
  const r = await pos("GET", "/orders/tags")
  const list = (r?.data ?? []).map((t: any) => ({ id: Number(t.id), name: String(t.name ?? "").trim(), system: !!t.is_system_tag }))
  tagCache = { at: Date.now(), list }
  return list
}

// Tag ids in shop 714216782 (GET /orders/tags, 21/10/2026). Used only to SUGGEST tags in the
// order card — the shop decided (21/10) the queue never tags an order on its own.
export const TAG_SUGGEST = {
  goi_lan: [50, 51, 52], // TrangThai_GoiLan{1,2,3}_ThatBai
  sale_chot: 32,
  sua_don: 68,
  khach_khong_dat: 41,
  don_trung: 31,
  rui_ro: 38,
  thieu_dia_chi: 40,
  suy_nghi: 33,
}
// Cancel reason → the shop's existing LyDo_* tag, suggested when cancelling.
export const CANCEL_REASON_TAG: Record<string, number> = {
  "Khách không đặt": 41,
  "Đơn trùng": 61,
  "Sai số": 60,
  "Không nghe máy nhiều lần": 59,
  "Thuê bao": 58,
  "Giá cao": 54,
  "Đổi ý": 55,
  "Mua bên khác": 56,
  "Không phù hợp": 57,
}
// Tags a sale sets by hand in the order card (the rest stay reachable through search).
export const QUICK_TAGS = [31, 38, 33, 40, 37, 36, 78, 70, 84, 86, 83, 71]

// Pancake seller ↔ admin user ↔ ITY extension. Pancake seller emails differ from admin
// login emails, so the mapping has to be explicit (verified 21/10/2026).
export const SALE_ROSTER = [
  { pancakeId: "6ba1866a-9b24-4560-a251-ca5af0da1b74", name: "Linh", adminEmail: "linhdnt.phv@gmail.com", extension: "207491001" },
  { pancakeId: "e9d3afff-9c41-4ab7-91d1-369ca6d1d26d", name: "HADTT", adminEmail: "hadtt.phv@gmail.com", extension: "207491003" },
]

export type LandingPackage = { text: string; price: number | null; freeship: boolean }

/**
 * Landing orders carry the customer's chosen offer in the internal note, e.g.
 * "radio_input_1: MUA 1 CHẢO - 299.000VNĐ + MIỄN PHÍ SHIP" or "MUA 3 CHẢO 2.199K TẶNG ...".
 * Price = first amount with a K / VNĐ / đ suffix.
 */
export function parseLandingPackage(note: string | null | undefined): LandingPackage | null {
  const m = String(note ?? "").match(/radio_input[^:]*:\s*([^\r\n]+)/i)
  if (!m) return null
  const text = m[1].replace(/[,\s]+$/, "").trim()
  const pm = text.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(k|vnđ|vnd|đ)(?![a-zà-ỹ])/i)
  let price: number | null = null
  if (pm) {
    const n = Number(pm[1].replace(/[.,]/g, ""))
    price = /^k$/i.test(pm[2]) ? n * 1000 : n
  }
  return { text, price, freeship: /miễn phí ship|free\s*ship/i.test(text) }
}

/** Last 9 digits — matches CDR numbers (84… / 0…) against order phones. */
export function phoneKey(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-9)
}

const VN_OFFSET = 7 * 3600_000
const MIN = 60_000
const HOUR = 3600_000

/** Sales call 08:00–21:00 VN; a due time outside that moves to the next 08:00. */
export function clampWorkHours(ms: number): number {
  const vn = new Date(ms + VN_OFFSET)
  const h = vn.getUTCHours()
  if (h >= 8 && h < 21) return ms
  const day = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate())
  const next8 = day + 8 * HOUR + (h >= 21 ? 24 * HOUR : 0)
  return next8 - VN_OFFSET
}

export type CallAttempt = { start: number; end: number; talkSec: number }

/** Re-dials within 10 minutes are one attempt (same rule as the 21/10 compliance audit). */
export function groupAttempts(calls: { at: number; billsec: number }[]): CallAttempt[] {
  const sorted = [...calls].sort((a, b) => a.at - b.at)
  const out: CallAttempt[] = []
  for (const c of sorted) {
    const last = out[out.length - 1]
    if (last && c.at - last.end <= 10 * MIN) {
      last.end = c.at
      last.talkSec = Math.max(last.talkSec, c.billsec)
    } else {
      out.push({ start: c.at, end: c.at, talkSec: c.billsec })
    }
  }
  return out
}

/** A call attempt counts as noted when a note lands between 5 min before and 60 min after it. */
export function attemptHasNote(a: CallAttempt, noteTimes: number[]): boolean {
  return noteTimes.some((t) => t >= a.start - 5 * MIN && t <= a.end + 60 * MIN)
}

// Notes written by the web queue look like "Linh · Hẹn gọi 14:00 22/10 · ...".
const HEN_RE = /Hẹn gọi (\d{1,2}):(\d{2}) (\d{1,2})\/(\d{1,2})/

export function parseCallbackAt(message: string, refMs: number): number | null {
  const m = String(message ?? "").match(HEN_RE)
  if (!m) return null
  const ref = new Date(refMs + VN_OFFSET)
  let year = ref.getUTCFullYear()
  // A December note scheduling "02/01" means next year.
  if (Number(m[4]) < ref.getUTCMonth() + 1 - 6) year++
  return Date.UTC(year, Number(m[4]) - 1, Number(m[3]), Number(m[1]), Number(m[2])) - VN_OFFSET
}

export type NextAction = { code: "first" | "retry" | "callback" | "cancel"; label: string; dueAt: number }

/**
 * Next step for an open order. attempts = max(notes, CDR attempts) so a call the sale
 * forgot to note still advances the cadence.
 */
export function computeNextAction(o: {
  createdAt: number
  attempts: number
  lastTouchAt: number | null
  callbackAt: number | null
  customerDeclined: boolean
  now: number
}): NextAction {
  const last = o.lastTouchAt ?? o.createdAt
  if (o.customerDeclined) return { code: "cancel", label: "Khách không đặt — xác nhận hủy", dueAt: o.now }
  if (o.callbackAt && o.callbackAt >= last - MIN) {
    const vn = new Date(o.callbackAt + VN_OFFSET)
    const hh = String(vn.getUTCHours()).padStart(2, "0")
    const mm = String(vn.getUTCMinutes()).padStart(2, "0")
    return { code: "callback", label: `Hẹn gọi ${hh}:${mm} ${vn.getUTCDate()}/${vn.getUTCMonth() + 1}`, dueAt: o.callbackAt }
  }
  switch (o.attempts) {
    case 0: return { code: "first", label: "Gọi lần đầu", dueAt: clampWorkHours(o.createdAt + 15 * MIN) }
    case 1: return { code: "retry", label: "Gọi lần 2", dueAt: clampWorkHours(last + 2 * HOUR) }
    case 2: return { code: "retry", label: "Gọi lần 3", dueAt: clampWorkHours(last + 4 * HOUR) }
    case 3: return { code: "retry", label: "Gọi lần 4 + nhắn Zalo", dueAt: clampWorkHours(last + 12 * HOUR) }
    case 4: return { code: "retry", label: "Gọi lần cuối", dueAt: clampWorkHours(last + 24 * HOUR) }
    default: return { code: "cancel", label: `Đề xuất hủy (gọi ${o.attempts} lần)`, dueAt: o.now }
  }
}

// ---- Phone reputation across the whole Pancake network ----

export type Reputation = { available: boolean; success?: number; fail?: number; warning?: number; return_rate?: number | null; flagged?: boolean }
const repCache = new Map<string, { at: number; data: Reputation }>()
const REP_TTL = 6 * 3600_000

/**
 * orders/bad_report_info is not in Pancake's API docs — found in the POS web bundle (21/10/2026).
 * Failures return { available: false } so callers just skip the signal.
 */
export async function getReputation(phone: string): Promise<Reputation> {
  const p = String(phone ?? "").replace(/\D/g, "")
  if (p.length < 9) return { available: false }
  const hit = repCache.get(p)
  if (hit && Date.now() - hit.at < REP_TTL) return hit.data
  try {
    const r = await pos("GET", `/orders/bad_report_info?phone_number=${p}`)
    let success = 0, fail = 0, warning = 0
    for (const v of Object.values<any>(r?.data?.reports_by_phone ?? {})) {
      success += v.order_success || 0
      fail += v.order_fail || 0
      warning += v.warning || 0
    }
    const total = success + fail
    const data: Reputation = {
      available: true, success, fail, warning,
      return_rate: total ? Math.round((fail / total) * 100) : null,
      flagged: (r?.data?.warning_phone_number ?? []).length > 0,
    }
    repCache.set(p, { at: Date.now(), data })
    return data
  } catch {
    return { available: false }
  }
}

export function cachedReputation(phone: string): Reputation | null {
  const hit = repCache.get(String(phone ?? "").replace(/\D/g, ""))
  return hit && Date.now() - hit.at < REP_TTL ? hit.data : null
}

/** Fill the cache for many phones within a time budget; whatever is left is fetched next refresh. */
export async function warmReputations(phones: string[], budgetMs = 8000, concurrency = 8): Promise<void> {
  const todo = [...new Set(phones)].filter((p) => !cachedReputation(p))
  const deadline = Date.now() + budgetMs
  let i = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < todo.length && Date.now() < deadline) await getReputation(todo[i++])
  }))
}

// ---- Priority (who to call first) ----

export type Priority = { score: number; reasons: string[]; repTier: "good" | "bad" | "neutral" | "unknown" }

/**
 * Score within a lane (first call vs call-back). Shop rules (21/10/2026): bigger orders first,
 * customers with a good buying history first, nobody waits too long. Weights are deliberately
 * simple so a sale can read the reasons; tune here.
 */
export function computePriority(o: {
  value: number
  rep: Reputation | null
  shopSucceeded: number
  firstCall: boolean
  createdAt: number
  dueAt: number
  isCallback: boolean
  now: number
}): Priority {
  const reasons: string[] = []
  let score = 0

  const valuePts = Math.min(30, Math.round(o.value / 50_000))
  score += valuePts
  if (o.value >= 1_000_000) reasons.push("đơn to")

  let repTier: Priority["repTier"] = "unknown"
  const rep = o.rep
  if (rep?.available) {
    const total = (rep.success ?? 0) + (rep.fail ?? 0)
    const rate = rep.return_rate ?? 0
    if (rep.flagged || (total >= 3 && rate >= 30)) {
      repTier = "bad"; score -= 20; reasons.push(`hoàn ${rate}%`)
    } else if ((rep.success ?? 0) >= 10 && rate < 5) {
      repTier = "good"; score += 20; reasons.push(`khách tốt ${rep.success}/${rep.fail}`)
    } else if ((rep.success ?? 0) >= 3 && rate < 10) {
      repTier = "good"; score += 12; reasons.push(`khách tốt ${rep.success}/${rep.fail}`)
    } else {
      repTier = "neutral"
    }
  }
  if (o.shopSucceeded > 0) { score += 10; reasons.push("khách cũ của shop") }

  if (o.isCallback && o.dueAt <= o.now) {
    score += 40; reasons.push("đến giờ hẹn")
  } else if (o.firstCall) {
    // New customers: every 4 minutes of waiting is worth a point, capped at 2 hours.
    const waitMin = Math.max(0, (o.now - o.createdAt) / 60_000)
    score += Math.min(30, Math.round(waitMin / 4))
    if (waitMin >= 30) reasons.push(`chờ ${waitMin >= 120 ? Math.round(waitMin / 60) + "h" : Math.round(waitMin) + "p"}`)
  } else {
    const overdueH = Math.max(0, (o.now - o.dueAt) / 3_600_000)
    score += Math.min(20, Math.round(overdueH * 2))
    // Stale backlog loses value: −3 per day since the order came in.
    const ageDays = (o.now - o.createdAt) / 86_400_000
    score -= Math.round(ageDays * 3)
  }
  return { score, reasons, repTier }
}

/** Alternate first-call and call-back lanes 1:1 so fresh orders never sit behind the backlog. */
export function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

/**
 * Orders that belong to the call queue = orders assigned to a sale in SALE_ROSTER.
 * Marketplace orders (Shopee VN/MY, TikTok Shop) are never assigned a sale on POS (verified
 * 14 days to 21/10/2026: 0 of ~2.500), so the assignment is the reliable channel split.
 * Unassigned orders are left out on purpose (shop decision 21/10).
 */
export const QUEUE_ORDER_SQL = `
  po.deleted_at IS NULL
  AND po.raw->'assigning_seller'->>'id' IN (${SALE_ROSTER.map((s) => `'${s.pancakeId}'`).join(", ")})`
