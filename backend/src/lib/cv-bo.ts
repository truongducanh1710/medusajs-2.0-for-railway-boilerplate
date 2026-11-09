// Quản lý BỘ chảo vàng tự động (user 9/11/2026: "tự scale tự làm tự bật tự lên camp mới; 1 bộ xác định là win thì luôn
// duy trì camp, xấu thì tắt, lên mới bật lại" — chốt: WIN 3 camp / SCALE 6, trần 12 camp, ngày xấu kiểu Xuân, chảo vàng trước).
//
// BỘ = tập post (object_story_id) trong các ad của camp. Camp cùng tập post = cùng bộ. Vòng đời bộ:
//   QUEUE (chờ test) → TEST (1 camp, 300k, chấm sau 3 ngày) → WIN (giữ 3 camp) ⇄ SCALE (6 camp) ⇄ GIU1 (1 camp) → NGHI (0 camp, 14 ngày) → QUEUE
//   TEST trượt → TRUOT. HOAN = người khoá (vd bộ Tết), hệ thống không đụng.
// Trong ngày theo kiểu Xuân (KINH_NGHIEM 35–37): tăng 300k→1tr khi 2 đơn ≤15%, 1tr→2tr khi ≥4 đơn ≤20%, 2tr→4tr khi ≥6 đơn ≤20% (6–20h);
// tắt tới hết ngày khi 0 đơn & 0 ĐK FB & chi ≥200k & (CPC ≥13k hoặc chi ≥300k), hoặc từ 15h có đơn mà >45% & chi ≥300k.
// 23h: về 300k, chấm bộ, lập danh sách bật lại 5h, lên camp mới (chỉ ngày tốt ≤35%) bằng ĐÚNG BÀI CŨ, chạy từ 5h hôm sau.
// 5h: bật lại theo danh sách. 21h: báo Telegram.
// Không gắn Tự scale cũ (auto_scale_camp) cho camp của bộ — 2 hệ thống không được cùng chạy trên 1 camp.

import { getPool } from "./db"
import { notifyTelegramByEmail } from "./notify"
import { MKT_ORDER_FILTER_SQL, ORDER_REVENUE_SQL } from "./mkt-today"
import { dayMode } from "./auto-scale-decide"
import { listExclusions } from "./ads-exclusion"
import { seedPost } from "./ads-seeding"
import { registerLaunch } from "./ads-tracking"
import { emailsForMkt } from "./auto-scale"

const GRAPH = "https://graph.facebook.com/v25.0"
const MKTS = ["XUANLT", "ANHTD"]
const SKU = "PHVVN026CV"
const PRODUCT = "CHẢO VÀNG HẤP"
const MKT_NEW = "ANHTD" // từ 21/10 camp mới đặt MKT ANHTD
const PIXEL = "943650651603498"
const LINK_DEFAULT = "https://www.giadungphanviet.shop/chaoultratitanmua1tang4"
const ACCOUNTS: Record<string, string> = {
  ADS344: "act_1397084955139677", ADS342: "act_741222868885235", ADS329: "act_899712815703406", ADS349: "act_1108526648426194",
}
const ACC_PRIORITY = ["ADS344", "ADS342", "ADS329", "ADS349"]
const PAGE_CODE: Record<string, string> = {
  "1137319289463834": "MĐGD", "693411540511731": "SMH", "609893108864013": "TICS", "1001347993069244": "VIETMATE",
}
const UTM = "utm_source={{campaign.name}}&utm_medium={{adset.name}}&utm_campaign={{campaign.id}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}"
export const BASE = 300_000
export const TARGET: Record<string, number> = { TEST: 1, WIN: 3, SCALE: 6, GIU1: 1, NGHI: 0, QUEUE: 0, TRUOT: 0, HOAN: 0 }
export const STATE_LABEL: Record<string, string> = {
  QUEUE: "Chờ test", TEST: "Đang test", WIN: "Thắng (3 camp)", SCALE: "Scale (6 camp)", GIU1: "Yếu — giữ 1 camp",
  NGHI: "Nghỉ 14 ngày", TRUOT: "Trượt", HOAN: "Người khoá",
}
const DATA_DAYS = 100 // mkt_ads_cost_ad có từ 20/7 — đủ gom bộ theo post

// ── Bảng ─────────────────────────────────────────────────────────────────────
let _ready: Promise<void> | null = null
export function ensureCvBoTables(): Promise<void> {
  if (_ready) return _ready
  _ready = (async () => {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS cv_bo_setting (
        id INT PRIMARY KEY DEFAULT 1,
        enabled BOOLEAN NOT NULL DEFAULT false,
        dry_run BOOLEAN NOT NULL DEFAULT true,
        max_camps INT NOT NULL DEFAULT 12,
        max_new_day INT NOT NULL DEFAULT 3,
        test_per_day INT NOT NULL DEFAULT 1,
        cap_total BIGINT NOT NULL DEFAULT 20000000,
        bad_day_pct NUMERIC(5,1) NOT NULL DEFAULT 35,
        week_stop_pct NUMERIC(5,1) NOT NULL DEFAULT 35,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO cv_bo_setting (id) VALUES (1) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS cv_bo (
        key TEXT PRIMARY KEY,
        name TEXT,
        page_id TEXT,
        posts JSONB,
        state TEXT NOT NULL,
        state_since DATE NOT NULL,
        extended BOOLEAN NOT NULL DEFAULT false,
        locked BOOLEAN NOT NULL DEFAULT false,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS cv_bo_camp (
        campaign_id TEXT PRIMARY KEY,
        bo_key TEXT,
        campaign_name TEXT,
        launched BOOLEAN NOT NULL DEFAULT false,
        retired BOOLEAN NOT NULL DEFAULT false,
        retired_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS cv_bo_log (
        id BIGSERIAL PRIMARY KEY,
        date DATE NOT NULL,
        at TEXT,
        action TEXT NOT NULL,          -- run | tang | tat | bat | reset | len | plan_bat | state | retire | loi
        bo_key TEXT,
        campaign_id TEXT,
        campaign_name TEXT,
        old_budget BIGINT,
        new_budget BIGINT,
        reason TEXT,
        detail JSONB,
        dry BOOLEAN NOT NULL DEFAULT true,
        ok BOOLEAN NOT NULL DEFAULT true,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_cv_bo_log_date ON cv_bo_log (date, action);
      -- Thứ tự ưu tiên trong hàng chờ test (bộ thêm tay từ đầu năm, 9/11): số lớn test trước
      ALTER TABLE cv_bo ADD COLUMN IF NOT EXISTS prio INT NOT NULL DEFAULT 0;
    `)
  })().catch((e) => { _ready = null; throw e })
  return _ready
}

export type CvBoSetting = {
  enabled: boolean; dry_run: boolean; max_camps: number; max_new_day: number; test_per_day: number
  cap_total: number; bad_day_pct: number; week_stop_pct: number; updated_by?: string; updated_at?: string
}
export async function getSetting(): Promise<CvBoSetting> {
  await ensureCvBoTables()
  const { rows } = await getPool().query(`SELECT * FROM cv_bo_setting WHERE id = 1`)
  const r = rows[0]
  return { ...r, max_camps: +r.max_camps, max_new_day: +r.max_new_day, test_per_day: +r.test_per_day, cap_total: +r.cap_total,
    bad_day_pct: +r.bad_day_pct, week_stop_pct: +r.week_stop_pct }
}

// ── Thời gian & FB ───────────────────────────────────────────────────────────
export function vnNow() {
  const d = new Date(Date.now() + 7 * 3600_000)
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}
const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5)
const norm = (s: any) => String(s || "").replace(/[​-‏⁠﻿]/g, "").trim().toUpperCase()
const vnd = (n: number) => `${Math.round(n / 1000).toLocaleString("vi-VN")}k`
const pctOf = (s: number, ds: number) => (ds > 0 ? (s / ds) * 100 : s > 0 ? Infinity : 0)
const fmtPct = (s: number, ds: number) => (ds > 0 ? `${Math.round((s / ds) * 100)}%` : s > 0 ? "0 đơn" : "-")
const token = () => process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""

async function fb(method: "GET" | "POST", path: string, body?: any): Promise<any> {
  const sep = path.includes("?") ? "&" : "?"
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${token()}`, method === "POST"
    ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) } : undefined)
  const d: any = await r.json().catch(() => ({}))
  if (d?.error) throw new Error(String(d.error.error_user_msg || d.error.message || "FB error").slice(0, 300))
  return d
}

// ── Số liệu ──────────────────────────────────────────────────────────────────
type Agg = { s: number; o: number; ds: number; days: number }
const zero = (): Agg => ({ s: 0, o: 0, ds: 0, days: 0 })
export type CampInfo = {
  id: string; name: string; acc: string; bo: string | null; first: string | null; last: string | null
  fb_status?: string; fb_effective?: string; budget?: number; created?: string; retired?: boolean
}
export type BoData = {
  today: string
  camps: Map<string, CampInfo>
  sets: Map<string, { key: string; posts: { post: string; vd: string }[]; page: string; name: string; camps: string[] }>
  sum: (campId: string, from: string, to: string) => Agg
  sumSet: (key: string, from: string, to: string) => Agg
  ordersToday: Map<string, { o: number; ds: number }>
}

export async function loadData(withFb = true): Promise<BoData> {
  await ensureCvBoTables()
  const pool = getPool()
  const today = vnNow().date
  const from = addD(today, -DATA_DAYS)
  const { rows: cost } = await pool.query(
    `SELECT date::date::text d, campaign_id c, campaign_name n, ad_account_id acc, SUM(spend)::bigint s FROM mkt_ads_cost
      WHERE deleted_at IS NULL AND mkt_name = ANY($1) AND date >= $2::date GROUP BY 1,2,3,4`,
    [MKTS, from]).then((r) => ({ rows: r.rows.filter((x: any) => isCv(x.n)) }))
  const cvCamp = new Set(cost.map((x: any) => x.c))
  const { rows: ads } = await pool.query(
    `SELECT DISTINCT a.campaign_id c, COALESCE(a.vd_code, split_part(a.ad_name, ' ', 1)) vd, m.post_id
       FROM mkt_ads_cost_ad a JOIN ad_video_map m ON m.ad_id = a.ad_id
      WHERE a.deleted_at IS NULL AND a.mkt_name = ANY($1) AND a.date >= $2::date AND m.post_id IS NOT NULL`,
    [MKTS, from]).then((r) => ({ rows: r.rows.filter((x: any) => cvCamp.has(x.c)) }))
  const { rows: mine } = await pool.query(`SELECT * FROM cv_bo_camp`)
  const { rows: ord } = await pool.query(
    `SELECT (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text d, raw->>'p_utm_campaign' ca, raw->>'p_utm_source' so,
            ${ORDER_REVENUE_SQL} ds
       FROM pancake_order WHERE ${MKT_ORDER_FILTER_SQL} AND status NOT IN (-2, 7)
        AND pancake_created_at >= $1::timestamptz AND (raw->>'p_utm_campaign' IS NOT NULL OR raw->>'p_utm_source' IS NOT NULL)`,
    [`${from}T00:00:00+07:00`])

  const camps = new Map<string, CampInfo>()
  const byName = new Map<string, string>()
  const CD = new Map<string, Agg>()
  for (const r of cost) {
    const x = camps.get(r.c) || { id: r.c, name: r.n, acc: r.acc, bo: null, first: null, last: null }
    if (+r.s > 0) { if (!x.first || r.d < x.first) x.first = r.d; if (!x.last || r.d > x.last) x.last = r.d }
    camps.set(r.c, x); byName.set(norm(r.n), r.c)
    const k = `${r.c}|${r.d}`; const a = CD.get(k) || zero(); a.s += +r.s; if (+r.s > 0) a.days = 1; CD.set(k, a)
  }
  for (const m of mine) {
    if (!camps.has(m.campaign_id)) camps.set(m.campaign_id, { id: m.campaign_id, name: m.campaign_name || "", acc: "", bo: m.bo_key, first: null, last: null })
    camps.get(m.campaign_id)!.retired = !!m.retired
  }
  const ordersToday = new Map<string, { o: number; ds: number }>()
  for (const o of ord) {
    const c = camps.has(norm(o.ca)) ? norm(o.ca) : byName.get(norm(o.ca)) || byName.get(norm(o.so))
    if (!c) continue
    const k = `${c}|${o.d}`; const a = CD.get(k) || zero(); a.o++; a.ds += +o.ds; CD.set(k, a)
    if (o.d === today) { const t = ordersToday.get(c) || { o: 0, ds: 0 }; t.o++; t.ds += +o.ds; ordersToday.set(c, t) }
  }
  // Bộ theo tập post
  const postsOf = new Map<string, Map<string, string>>()
  for (const a of ads) { const m = postsOf.get(a.c) || new Map(); m.set(a.post_id, a.vd); postsOf.set(a.c, m) }
  const sets: BoData["sets"] = new Map()
  for (const [cid, m] of postsOf) {
    if (!camps.has(cid)) continue
    const posts = [...m.keys()].sort(); const key = posts.join(",")
    const s = sets.get(key) || { key, posts: posts.map((p) => ({ post: p, vd: String(m.get(p) || "?") })), page: posts[0].split("_")[0], name: "", camps: [] }
    s.camps.push(cid); camps.get(cid)!.bo = key; sets.set(key, s)
  }
  for (const m of mine) { // camp hệ thống vừa lên, chưa có số liệu ad
    if (!m.bo_key) continue
    const c = camps.get(m.campaign_id)!; if (c.bo) continue
    c.bo = m.bo_key
    const s = sets.get(m.bo_key); if (s && !s.camps.includes(m.campaign_id)) s.camps.push(m.campaign_id)
  }
  for (const s of sets.values()) s.name = "VD" + s.posts.map((p) => p.vd.replace(/^VD/i, "")).join("+")

  const sum = (cid: string, a: string, b: string) => {
    const t = zero(); for (let d = a; d <= b; d = addD(d, 1)) { const x = CD.get(`${cid}|${d}`); if (x) { t.s += x.s; t.o += x.o; t.ds += x.ds; t.days += x.days } }
    return t
  }
  const sumSet = (key: string, a: string, b: string) => {
    const t = zero(); for (const c of sets.get(key)?.camps || []) { const x = sum(c, a, b); t.s += x.s; t.o += x.o; t.ds += x.ds; t.days = Math.max(t.days, x.days) }
    return t
  }
  if (withFb) {
    // Trạng thái thật trên FB cho camp có chi 30 ngày gần đây + camp hệ thống lên
    const ids = [...camps.values()].filter((c) => (c.last && c.last >= addD(today, -30)) || mine.some((m: any) => m.campaign_id === c.id)).map((c) => c.id)
    for (let i = 0; i < ids.length; i += 50) {
      const j = await fb("GET", `/?ids=${ids.slice(i, i + 50).join(",")}&fields=name,status,effective_status,daily_budget,created_time,account_id`).catch(() => ({}))
      for (const [id, v] of Object.entries<any>(j)) {
        const c = camps.get(id); if (!c) continue
        c.fb_status = v.status; c.fb_effective = v.effective_status; c.budget = +v.daily_budget || 0; c.created = String(v.created_time || "").slice(0, 10)
        if (v.name) c.name = v.name
        if (!c.acc && v.account_id) c.acc = `act_${v.account_id}`
      }
    }
  }
  return { today, camps, sets, sum, sumSet, ordersToday }
}

// ── Ghi nhật ký / thao tác FB ────────────────────────────────────────────────
// Xem trước (preview): không ghi gì vào DB, gom các dòng "lẽ ra" trả về cho người xem
let previewSink: any[] | null = null
async function logRow(o: { action: string; bo_key?: string | null; camp?: CampInfo | null; old_budget?: number | null; new_budget?: number | null
  reason: string; detail?: any; dry: boolean; ok?: boolean; error?: string | null; date?: string }) {
  const n = vnNow()
  if (previewSink) { previewSink.push({ at: `${n.hour}:${String(n.minute).padStart(2, "0")}`, action: o.action, camp: o.camp?.name ?? null, old_budget: o.old_budget ?? null, new_budget: o.new_budget ?? null, reason: o.reason, error: o.error ?? null }); return }
  await getPool().query(
    `INSERT INTO cv_bo_log (date, at, action, bo_key, campaign_id, campaign_name, old_budget, new_budget, reason, detail, dry, ok, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,
    [o.date || n.date, `${n.hour}:${String(n.minute).padStart(2, "0")}`, o.action, o.bo_key ?? o.camp?.bo ?? null, o.camp?.id ?? null, o.camp?.name ?? null,
     o.old_budget ?? null, o.new_budget ?? null, o.reason, JSON.stringify(o.detail ?? null), o.dry, o.ok ?? true, o.error ?? null])
}

async function campAction(camp: CampInfo, action: "pause" | "activate" | "set_budget", oldV: any, newV: any, resp: any, ok: boolean) {
  await getPool().query(
    `INSERT INTO camp_action_log (campaign_id, campaign_name, action, old_value, new_value, source, user_email, fb_response, success)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'cv_bo','he-thong:bo-chao-vang',$6::jsonb,$7)`,
    [camp.id, camp.name, action, JSON.stringify(oldV), JSON.stringify(newV), JSON.stringify(resp ?? null), ok]).catch(() => {})
}

async function doBudget(camp: CampInfo, to: number, action: "tang" | "reset", reason: string, dry: boolean, detail?: any) {
  const from = camp.budget || 0
  let ok = true, error: string | null = null, resp: any = null
  if (!dry) {
    try { resp = await fb("POST", `/${camp.id}`, { daily_budget: Math.round(to) }) } catch (e: any) { ok = false; error = e.message }
    await campAction(camp, "set_budget", { daily_budget: from }, { daily_budget: to }, resp ?? { error }, ok)
    if (ok) camp.budget = to
  }
  await logRow({ action, camp, old_budget: from, new_budget: to, reason, detail, dry, ok, error })
  return ok
}

async function doStatus(camp: CampInfo, status: "ACTIVE" | "PAUSED", action: "tat" | "bat", reason: string, dry: boolean, detail?: any) {
  let ok = true, error: string | null = null, resp: any = null
  if (!dry) {
    try {
      if (status === "ACTIVE" && (camp.budget || 0) !== BASE) await fb("POST", `/${camp.id}`, { daily_budget: BASE })
      resp = await fb("POST", `/${camp.id}`, { status })
    } catch (e: any) { ok = false; error = e.message }
    await campAction(camp, status === "ACTIVE" ? "activate" : "pause", { status: camp.fb_status }, { status }, resp ?? { error }, ok)
    if (ok) { camp.fb_status = status; camp.fb_effective = status; if (status === "ACTIVE") camp.budget = BASE }
  }
  await logRow({ action, camp, old_budget: camp.budget ?? null, new_budget: status === "ACTIVE" ? BASE : camp.budget ?? null, reason, detail, dry, ok, error })
  return ok
}

async function loggedToday(action: string, date: string, dry: boolean, campaignId?: string, reasonLike?: string): Promise<any[]> {
  const params: any[] = [date, action, dry]
  let extra = ""
  if (campaignId) { params.push(campaignId); extra += ` AND campaign_id = $${params.length}` }
  if (reasonLike) { params.push(reasonLike); extra += ` AND reason LIKE $${params.length}` }
  const { rows } = await getPool().query(
    `SELECT * FROM cv_bo_log WHERE date = $1 AND action = $2 AND dry = $3 AND ok ${extra} ORDER BY created_at`, params)
  return rows
}

/** Camp người tắt tay trên web trong 3 ngày qua → hệ thống không tự bật lại (người đã quyết). */
async function humanPausedRecently(campaignId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM camp_action_log WHERE campaign_id = $1 AND action = 'pause' AND source NOT IN ('cv_bo','auto_scale')
        AND created_at > now() - interval '3 days' LIMIT 1`, [campaignId]).catch(() => ({ rows: [] as any[] }))
  return rows.length > 0
}

/** Camp chảo vàng: mã PHVVN026CV, hoặc tên kiểu cũ đầu năm ("23/1_XUANLT_CHẢO VÀNG HẤP_...") */
export const isCv = (name: string) => { const n = String(name || "").normalize("NFC").toUpperCase(); return n.startsWith(SKU) || n.includes("CHẢO VÀNG") }
const inScope = (c: CampInfo) => isCv(c.name)

// ── Chấm bộ (23h, số liệu tới hết hôm nay) ───────────────────────────────────
type BoRow = { key: string; name: string; page_id: string; posts: any; state: string; state_since: string; extended: boolean; locked: boolean; note: string | null; prio?: number }

export function evalBo(b: BoRow, D: BoData, asOf: string): { state: string; since: string; extended: boolean; why: string } | null {
  const keep = null
  if (b.locked || b.state === "HOAN" || b.state === "TRUOT" || b.state === "QUEUE") return keep
  if (b.state === "NGHI") {
    return daysBetween(b.state_since, asOf) >= 14 ? { state: "QUEUE", since: asOf, extended: false, why: "Nghỉ đủ 14 ngày → chờ test lại 1 camp" } : keep
  }
  if (b.state === "TEST") {
    const t = D.sumSet(b.key, b.state_since, asOf), days = daysBetween(b.state_since, asOf) + 1, p = pctOf(t.s, t.ds)
    const tag = `test ${days} ngày: chi ${vnd(t.s)}, ${t.o} đơn, ${fmtPct(t.s, t.ds)}`
    if (t.s >= 300_000 && t.o === 0) return { state: "TRUOT", since: asOf, extended: false, why: `Trượt — ${tag}` }
    if (t.s >= 800_000 && t.o <= 1) return { state: "TRUOT", since: asOf, extended: false, why: `Trượt — ${tag}` }
    if (days < 3) return keep
    // Camp test chưa tiêu được (FB chưa phân phối / bị tắt) → chưa đủ mẫu, đợi tối đa 7 ngày
    if (t.s < 200_000 && t.o === 0) return days >= 7 ? { state: "TRUOT", since: asOf, extended: false, why: `Trượt — 7 ngày không tiêu được (${tag})` } : keep
    if (t.o >= 3 && p <= 35) return { state: "WIN", since: asOf, extended: false, why: `Thắng — ${tag}` }
    if (!b.extended && t.o > 0 && p <= 50) return { state: "TEST", since: b.state_since, extended: true, why: `Gia hạn test thêm 3 ngày — ${tag}` }
    if (b.extended && days < 6) return keep
    return { state: "TRUOT", since: asOf, extended: false, why: `Trượt — ${tag}` }
  }
  // WIN / SCALE / GIU1: theo 7 ngày gần nhất của cả bộ
  const w = D.sumSet(b.key, addD(asOf, -6), asOf), p = pctOf(w.s, w.ds)
  const tag = `7 ngày: chi ${vnd(w.s)}, ${w.o} đơn, ${fmtPct(w.s, w.ds)}`
  let next = "WIN"
  if (w.s >= 1_000_000 && (w.o === 0 || p > 50)) next = "NGHI"
  else if (w.o >= 10 && p <= 28) next = "SCALE"
  else if (w.s >= 1_000_000 && p > 35) next = "GIU1"
  if (next === b.state) return keep
  const why = next === "NGHI" ? `Nghỉ — ${tag}` : next === "SCALE" ? `Lên scale 6 camp — ${tag}` : next === "GIU1" ? `Yếu, giữ 1 camp — ${tag}` : `Về thắng 3 camp — ${tag}`
  return { state: next, since: asOf, extended: false, why }
}

/** Bộ chưa có trong bảng → xếp lần đầu từ lịch sử. */
function initState(key: string, D: BoData, asOf: string): { state: string; since: string; why: string } | null {
  const s = D.sets.get(key)!; const camps = s.camps.map((c) => D.camps.get(c)!)
  const all = D.sumSet(key, addD(asOf, -DATA_DAYS), asOf)
  const running = camps.some((c) => c.fb_status === "ACTIVE" || (c.last && c.last >= addD(asOf, -1)))
  const first = camps.map((c) => c.first).filter(Boolean).sort()[0] as string | undefined
  if (running) {
    // Bộ mới / ít số liệu (<5 đơn cả kỳ) → chấm như test từ ngày chạy đầu, không xếp thẳng vào thắng
    if (first && (first >= addD(asOf, -6) || all.o < 5)) return { state: "TEST", since: first, why: "Bộ mới / ít số liệu đang chạy → chấm như test" }
    return { state: "WIN", since: asOf, why: "Bộ đang chạy → xếp theo 7 ngày" }
  }
  if (all.s < 300_000) return null
  if (all.o >= 10 && pctOf(all.s, all.ds) <= 33 && all.s >= 2_000_000)
    return { state: "QUEUE", since: asOf, why: `Bộ từng thắng (${DATA_DAYS} ngày: ${all.o} đơn ${fmtPct(all.s, all.ds)}) lâu chưa chạy → chờ test lại` }
  return { state: "TRUOT", since: asOf, why: `Bộ cũ không đủ thắng (${all.o} đơn ${fmtPct(all.s, all.ds)})` }
}

async function syncBoTable(D: BoData, asOf: string, dry: boolean): Promise<Map<string, BoRow>> {
  const pool = getPool()
  const { rows } = await pool.query(`SELECT key, name, page_id, posts, state, state_since::text, extended, locked, note, prio FROM cv_bo`)
  const M = new Map<string, BoRow>(rows.map((r: any) => [r.key, r]))
  for (const s of D.sets.values()) {
    if (M.has(s.key)) continue
    const st = initState(s.key, D, asOf); if (!st) continue
    const row: BoRow = { key: s.key, name: s.name, page_id: s.page, posts: s.posts, state: st.state, state_since: st.since, extended: false, locked: false, note: st.why }
    // Bảng bộ là trạng thái (không phải thao tác FB) — ghi cả khi chạy thử để xem trước được (trừ preview)
    if (!previewSink) await pool.query(`INSERT INTO cv_bo (key, name, page_id, posts, state, state_since, note) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT (key) DO NOTHING`,
      [row.key, row.name, row.page_id, JSON.stringify(row.posts), row.state, row.state_since, row.note])
    await logRow({ action: "state", bo_key: s.key, reason: `${s.name}: xếp lần đầu ${STATE_LABEL[st.state]} — ${st.why}`, dry })
    M.set(s.key, row)
  }
  return M
}

// ── Lên camp mới bằng bài cũ ─────────────────────────────────────────────────
async function pickAccount(setKey: string, D: BoData, aliveByAcc: Map<string, number>, excl: any[]): Promise<{ code: string; id: string } | null> {
  const s = D.sets.get(setKey)
  const used = new Set((s?.camps || []).map((c) => D.camps.get(c)?.acc).filter(Boolean))
  const ok = Object.entries(ACCOUNTS).filter(([, id]) => (used.size === 0 || used.has(id)) && exclusionsFor(excl, id))
  if (!ok.length) return null
  const { rows: health } = await getPool().query(
    `SELECT DISTINCT ON (account_id) account_id, muc, ma_van_de FROM fb_account_health WHERE checked_at > now() - interval '6 hours' ORDER BY account_id, checked_at DESC`)
    .catch(() => ({ rows: [] as any[] }))
  const red = new Set(health.filter((h: any) => h.muc === "do").map((h: any) => String(h.account_id).replace(/^act_/, "")))
  const cand = ok.filter(([, id]) => !red.has(id.replace(/^act_/, "")))
  if (!cand.length) return null
  // User 9/11: chảo vàng ưu tiên tài khoản ADS344 → ADS342 → ADS329 (ADS349 cuối) — không chia đều theo số camp
  cand.sort((a, b) => ACC_PRIORITY.indexOf(a[0]) - ACC_PRIORITY.indexOf(b[0]))
  return { code: cand[0][0], id: cand[0][1] }
}

function exclusionsFor(excl: any[], acc: string) {
  const px = excl.find((a) => a.account_id === acc && a.kind === "pixel_cr180" && a.pixel_id === PIXEL)
  const blk = excl.find((a) => a.account_id === acc && a.kind === "chan_pos")
  return px && blk ? [{ id: px.audience_id }, { id: blk.audience_id }] : null
}

async function launchCamp(o: { bo: BoRow; acc: { code: string; id: string }; start: string; suffix: string; kieu: "test" | "nhan"; reason: string
  excl: any[]; dry: boolean }): Promise<string | null> {
  const { bo, acc, start, dry } = o
  const posts: { post: string; vd: string }[] = Array.isArray(bo.posts) ? bo.posts : []
  const [, m, d] = start.split("-"); const dm = `${+d}/${+m}`
  const setName = "VD" + posts.map((p) => String(p.vd).replace(/^VD/i, "")).join("")
  const name = `${SKU}_${dm}_${MKT_NEW}_${PRODUCT}_${acc.code}_${PAGE_CODE[bo.page_id] || "PAGE"}_${setName}_30ALL_${o.suffix}`
  const excluded = exclusionsFor(o.excl, acc.id)
  const detail = { account: acc.code, start, posts, kieu: o.kieu }
  if (!excluded) { await logRow({ action: "loi", bo_key: bo.key, reason: `Không lên được ${name}: tài khoản thiếu tệp loại trừ`, dry, ok: false }); return null }
  if (dry) { await logRow({ action: "len", bo_key: bo.key, camp: { id: "", name, acc: acc.id, bo: bo.key, first: null, last: null }, new_budget: BASE, reason: o.reason, detail, dry }); return "dry" }
  let campId: string | null = null
  try {
    const creatives: { vd: string; id: string; post: string }[] = []
    for (const p of posts) {
      const cr = await fb("POST", `/${acc.id}/adcreatives`, { name: `CR_${p.vd}_${dm}`, object_story_id: p.post, url_tags: UTM })
      creatives.push({ vd: p.vd, id: cr.id, post: p.post })
    }
    const camp = await fb("POST", `/${acc.id}/campaigns`, { name, objective: "OUTCOME_SALES", status: "PAUSED", special_ad_categories: [],
      daily_budget: BASE, bid_strategy: "LOWEST_COST_WITHOUT_CAP" })
    campId = camp.id
    const adset = await fb("POST", `/${acc.id}/adsets`, { name: setName, campaign_id: camp.id, billing_event: "IMPRESSIONS", optimization_goal: "OFFSITE_CONVERSIONS",
      promoted_object: { pixel_id: PIXEL, custom_event_type: "COMPLETE_REGISTRATION", smart_pse_enabled: false },
      // User 9/11: gợi ý đối tượng tuổi 30–65+ (Advantage+ giữ khung 25–65) + loại trừ khách hiện có ở "Chiến lược vòng đời khách hàng"
      targeting: { geo_locations: { countries: ["VN"], location_types: ["home", "recent"] }, age_min: 25, age_max: 65, age_range: [30, 65], targeting_automation: { advantage_audience: 1 },
        excluded_custom_audiences: excluded, brand_safety_content_filter_levels: ["FACEBOOK_RELAXED", "AN_RELAXED"] },
      ad_set_goal: { type: 2, existing_customers_exclusions: excluded.map((x) => x.id) },
      attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }, { event_type: "ENGAGED_VIDEO_VIEW", window_days: 1 }],
      start_time: `${start}T05:00:00+0700`, status: "ACTIVE" })
    for (const c of creatives) await fb("POST", `/${acc.id}/ads`, { name: `${c.vd} - ${c.post.split("_")[1]}`, adset_id: adset.id, creative: { creative_id: c.id }, status: "ACTIVE" })
    await fb("POST", `/${camp.id}`, { status: "ACTIVE" })
    await getPool().query(`INSERT INTO cv_bo_camp (campaign_id, bo_key, campaign_name, launched) VALUES ($1,$2,$3,true) ON CONFLICT (campaign_id) DO NOTHING`, [camp.id, bo.key, name])
    const seeding: string[] = []
    for (const p of posts) { const r = await seedPost({ post_id: p.post, product_code: SKU, link: LINK_DEFAULT, by: "cv-bo" }).catch((e: any) => ({ status: "lỗi " + e.message })); seeding.push(String((r as any).status)) }
    await registerLaunch({ campaign_id: camp.id, campaign_name: name, product_code: SKU, mkt_name: MKT_NEW, account_id: acc.id, page_id: bo.page_id,
      mode: o.kieu, videos: posts.map((p) => p.vd), post_ids: posts.map((p) => p.post), start_at: `${start}T05:00:00+07:00`, exclusions: excluded, seeding, reason: o.reason }, "cv-bo").catch(() => {})
    await logRow({ action: "len", bo_key: bo.key, camp: { id: camp.id, name, acc: acc.id, bo: bo.key, first: null, last: null }, new_budget: BASE, reason: o.reason, detail: { ...detail, seeding }, dry })
    return camp.id
  } catch (e: any) {
    await logRow({ action: "loi", bo_key: bo.key, camp: campId ? { id: campId, name, acc: acc.id, bo: bo.key, first: null, last: null } : null,
      reason: `Lỗi lên camp ${name}${campId ? " (camp đã tạo, đang TẮT — xem lại tay)" : ""}`, error: e.message, dry, ok: false })
    return null
  }
}

// ── Trong ngày (6h–20h): tăng / tắt kiểu Xuân ───────────────────────────────
export async function runCheck(st: CvBoSetting, D?: BoData) {
  const dry = st.dry_run
  D = D || await loadData()
  const { hour } = vnNow(), today = D.today
  if (hour < 6 || hour > 20) return { actions: 0, note: "ngoài 6h–20h" }
  const active = [...D.camps.values()].filter((c) => inScope(c) && c.fb_effective === "ACTIVE" && !c.retired)
  const pausedToday = new Set((await loggedToday("tat", today, dry)).map((r) => r.campaign_id))
  const raisedToday = new Map<string, number>()
  for (const r of await loggedToday("tang", today, dry)) raisedToday.set(r.campaign_id, Math.max(raisedToday.get(r.campaign_id) || 0, Date.parse(r.created_at)))
  const rows: any[] = []
  let tot = { s: 0, ds: 0 }
  for (const c of active) {
    const j = await fb("GET", `/${c.id}/insights?date_preset=today&fields=spend,inline_link_clicks,actions`).catch(() => ({}))
    const r = j?.data?.[0] || {}
    const s = +r.spend || 0, lc = +r.inline_link_clicks || 0
    const reg = +((r.actions || []).find((a: any) => /complete_registration/.test(a.action_type))?.value || 0)
    const o = D.ordersToday.get(c.id) || { o: 0, ds: 0 }
    tot.s += s; tot.ds += o.ds
    rows.push({ c, s, o: o.o, ds: o.ds, p: pctOf(s, o.ds), cpc: lc ? s / lc : 99_000, reg })
  }
  const dm = dayMode(hour, tot.s, tot.ds)
  const budgetSum = active.reduce((a, c) => a + (c.budget || 0), 0)
  let actions = 0
  for (const r of rows) {
    const c: CampInfo = r.c
    if (pausedToday.has(c.id)) continue // đã tắt hôm nay mà người bật lại → tôn trọng tới hết ngày
    const d = `chi ${vnd(r.s)}, ${r.o} đơn${r.o ? " " + Math.round(r.p) + "%" : ""}, ĐK FB ${r.reg}, CPC ${vnd(r.cpc)}`
    if (r.o === 0 && r.reg === 0 && r.s >= 200_000 && (r.cpc >= 13_000 || r.s >= 300_000)) {
      await doStatus(c, "PAUSED", "tat", `Tắt tới hết ngày: 0 đơn & chưa ĐK — ${d}`, dry, r); actions++; continue
    }
    if (hour >= 15 && r.o > 0 && r.p > 45 && r.s >= 300_000) {
      await doStatus(c, "PAUSED", "tat", `Tắt tới hết ngày: >45% từ 15h — ${d}`, dry, r); actions++; continue
    }
    const b = c.budget || 0
    let nb = 0
    if (b <= 400_000 && r.o >= 2 && r.p <= 15) nb = 1_000_000
    else if (b >= 900_000 && b < 2_000_000 && r.o >= 4 && r.p <= 20) nb = 2_000_000
    else if (b >= 2_000_000 && b < 4_000_000 && r.o >= 6 && r.p <= 20) nb = 4_000_000
    if (!nb || nb <= b) continue
    if (dm.stop_raise) continue // lỗ ngày ≥3tr: không tăng thêm
    if (budgetSum + (nb - b) > st.cap_total) continue
    const last = raisedToday.get(c.id)
    if (last && Date.now() - last < 120 * 60_000) continue
    // chạy thử: không ghi lặp cùng 1 nấc trong ngày
    if (dry && (await loggedToday("tang", today, true, c.id)).some((x) => +x.new_budget === nb)) continue
    await doBudget(c, nb, "tang", `Tăng ${vnd(b)} → ${vnd(nb)}: ${d}`, dry, r); actions++
  }
  return { actions, camps: rows.length, spend: tot.s, revenue: tot.ds }
}

// ── 23h: về nền, loại camp xấu 3 ngày, chấm bộ, lập kế hoạch 5h, lên camp mới ──
export async function runNight(st: CvBoSetting, userModule?: any) {
  const dry = st.dry_run
  const D = await loadData()
  const today = D.today, tomorrow = addD(today, 1)
  const pool = getPool()
  const scope = [...D.camps.values()].filter(inScope)
  const pausedToday = new Set((await loggedToday("tat", today, dry)).map((r) => r.campaign_id))
  const out: string[] = []

  // 1. Về nền 300k
  for (const c of scope) {
    if (c.fb_status !== "ACTIVE" && !pausedToday.has(c.id)) continue
    if ((c.budget || 0) > BASE) { await doBudget(c, BASE, "reset", `23h về nền 300k (đang ${vnd(c.budget || 0)})`, dry) }
  }
  // 2. Camp xấu 3 ngày liền → loại (không bật lại nữa)
  for (const c of scope) {
    if (c.retired || !(c.fb_status === "ACTIVE" || pausedToday.has(c.id))) continue
    const bad = [0, 1, 2].every((k) => { const x = D.sum(c.id, addD(today, -k), addD(today, -k)); return x.s >= 200_000 && (x.o === 0 || pctOf(x.s, x.ds) > 45) })
    if (!bad) continue
    c.retired = true
    if (!dry) await pool.query(`INSERT INTO cv_bo_camp (campaign_id, bo_key, campaign_name, retired, retired_reason) VALUES ($1,$2,$3,true,$4)
      ON CONFLICT (campaign_id) DO UPDATE SET retired = true, retired_reason = EXCLUDED.retired_reason`, [c.id, c.bo, c.name, "Xấu 3 ngày liền"])
    await logRow({ action: "retire", camp: c, reason: "Loại camp: xấu 3 ngày liền (mỗi ngày chi ≥200k mà 0 đơn hoặc >45%)", dry })
    if (c.fb_status === "ACTIVE") await doStatus(c, "PAUSED", "tat", "Loại camp xấu 3 ngày liền", dry)
    out.push(`loại ${c.name}`)
  }
  // 3. Chấm bộ
  const B = await syncBoTable(D, today, dry)
  for (const b of B.values()) {
    const e = evalBo(b, D, today); if (!e) continue
    // Chạy thử: chỉ ghi "lẽ ra", không đổi trạng thái thật của bộ (camp không thật sự chạy theo kế hoạch)
    if (!dry) await pool.query(`UPDATE cv_bo SET state=$2, state_since=$3, extended=$4, note=$5, updated_at=now() WHERE key=$1`, [b.key, e.state, e.since, e.extended, e.why])
    await logRow({ action: "state", bo_key: b.key, reason: `${b.name}: ${STATE_LABEL[b.state]} → ${STATE_LABEL[e.state]} — ${e.why}`, dry })
    Object.assign(b, { state: e.state, state_since: e.since, extended: e.extended, note: e.why })
  }
  // 4. Ngày tốt / dừng tuần
  const tot = scope.reduce((a, c) => { const x = D.sum(c.id, today, today); a.s += x.s; a.ds += x.ds; return a }, { s: 0, ds: 0 })
  const wk = scope.reduce((a, c) => { const x = D.sum(c.id, addD(today, -6), today); a.s += x.s; a.ds += x.ds; return a }, { s: 0, ds: 0 })
  const goodDay = pctOf(tot.s, tot.ds) <= st.bad_day_pct
  const weekStop = wk.s >= 3_000_000 && pctOf(wk.s, wk.ds) > st.week_stop_pct
  const allowNew = goodDay && !weekStop
  out.push(`Hôm nay chảo vàng chi ${vnd(tot.s)} ${fmtPct(tot.s, tot.ds)} → ${goodDay ? "ngày tốt" : "ngày xấu: chỉ bật lại camp cũ, không lên mới"}${weekStop ? `; 7 ngày ${fmtPct(wk.s, wk.ds)} > ${st.week_stop_pct}% → dừng lên mới` : ""}`)

  // 5. Kế hoạch theo bộ
  const excl = await listExclusions().catch(() => [])
  const newToday = (await loggedToday("len", today, dry)).length
  // User 9/11 (lần 2): bù camp cho bộ SCALE → WIN trước (chắc ăn hơn test), test dùng phần còn lại;
  // chỉ giữ chỗ 1 camp mới cho test để hàng chờ không đứng. Test tối đa test_per_day bộ/ngày.
  const testsDone = (await loggedToday("state", today, dry, undefined, "%Chờ test → Đang test%")).length
  const queued = [...B.values()].filter((b) => b.state === "QUEUE" && !b.locked).length
  const reserveTest = allowNew ? Math.min(queued, Math.max(0, 1 - testsDone)) : 0
  let newCount = newToday
  const aliveByAcc = new Map<string, number>()
  const isAlive = (c: CampInfo) => !c.retired && c.fb_status === "ACTIVE"
  const planBat: CampInfo[] = []
  // Camp hệ thống tắt hôm nay → mặc định bật lại 5h (trừ camp mới ≤2 ngày chưa từng có đơn)
  const resumeDefault = new Set<string>()
  for (const id of pausedToday) {
    const c = D.camps.get(id); if (!c || c.retired || c.fb_status !== "PAUSED") continue
    const life = D.sum(id, addD(today, -DATA_DAYS), today)
    const age = c.created ? daysBetween(c.created, today) : 99
    if (age <= 2 && life.o === 0) { out.push(`không bật lại (mới ${age} ngày, chưa có đơn) ${c.name}`); continue }
    resumeDefault.add(id)
  }
  const order = ["SCALE", "WIN", "GIU1", "TEST"]
  const boList = [...B.values()].filter((b) => order.includes(b.state) && !b.locked)
    .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || pctOf(D.sumSet(a.key, addD(today, -6), today).s, D.sumSet(a.key, addD(today, -6), today).ds) - pctOf(D.sumSet(b.key, addD(today, -6), today).s, D.sumSet(b.key, addD(today, -6), today).ds))
  // Camp không thuộc bộ nào trong danh sách vẫn tính vào trần 12
  const boCamps = new Set(boList.flatMap((b) => D.sets.get(b.key)?.camps || []))
  let total = scope.filter((c) => !boCamps.has(c.id) && (isAlive(c) || resumeDefault.has(c.id))).length
  for (const id of resumeDefault) if (!boCamps.has(id)) planBat.push(D.camps.get(id)!)
  for (const c of scope) if (isAlive(c) || resumeDefault.has(c.id)) aliveByAcc.set(c.acc, (aliveByAcc.get(c.acc) || 0) + 1)

  // Bộ không còn mục tiêu (NGHI/TRUOT/QUEUE) mà còn camp chạy → tắt; camp tắt hôm nay thì không bật lại
  for (const b of B.values()) {
    if (order.includes(b.state) || b.locked || b.state === "HOAN") continue
    for (const id of D.sets.get(b.key)?.camps || []) {
      const c = D.camps.get(id)!; resumeDefault.delete(id)
      if (isAlive(c) && inScope(c)) { await doStatus(c, "PAUSED", "tat", `Bộ ${b.name} ${STATE_LABEL[b.state]} — tắt camp`, dry); out.push(`tắt ${c.name} (bộ ${STATE_LABEL[b.state]})`) }
    }
  }
  for (const b of boList) {
    const target = TARGET[b.state]
    const sc = (D.sets.get(b.key)?.camps || []).map((id) => D.camps.get(id)!).filter(inScope)
    const alive = sc.filter((c) => isAlive(c) || resumeDefault.has(c.id))
    // Thừa → tắt camp kém nhất (7 ngày)
    const score = (c: CampInfo) => { const x = D.sum(c.id, addD(today, -6), today); return pctOf(x.s, x.ds) }
    alive.sort((a, c) => score(a) - score(c))
    // Trần max_camps chỉ chặn bật thêm / lên mới — KHÔNG tắt camp đang chạy của bộ khác (preview 9/11 định tắt VD131+133+134 S1)
    const keepN = target
    const keep = alive.slice(0, keepN), extra = alive.slice(keepN)
    for (const c of extra) {
      if (resumeDefault.has(c.id)) { resumeDefault.delete(c.id); continue }
      await doStatus(c, "PAUSED", "tat", `Bộ ${b.name} ${STATE_LABEL[b.state]}: thừa camp (giữ ${keepN}) — tắt camp kém nhất`, dry); out.push(`tắt thừa ${c.name}`)
    }
    for (const c of keep) if (resumeDefault.has(c.id)) planBat.push(c)
    total += keep.length
    let need = Math.min(target - keep.length, Math.max(0, st.max_camps - total))
    if (need <= 0) continue
    // Thiếu → bật lại camp cũ của bộ trước (tắt ≤14 ngày, lần chạy gần nhất không quá 40%, không phải người vừa tắt)
    const cands: CampInfo[] = []
    for (const c of sc) {
      if (keep.includes(c) || c.retired || c.fb_status !== "PAUSED" || !c.last || c.last < addD(today, -14)) continue
      const x = D.sum(c.id, addD(c.last, -2), c.last)
      if (x.s > 0 && pctOf(x.s, x.ds) > 40) continue
      if (await humanPausedRecently(c.id)) continue
      cands.push(c)
    }
    cands.sort((a, c) => { const x = D.sum(a.id, addD(today, -DATA_DAYS), today), y = D.sum(c.id, addD(today, -DATA_DAYS), today); return pctOf(x.s, x.ds) - pctOf(y.s, y.ds) })
    for (const c of cands.slice(0, need)) { planBat.push(c); total++; need--; aliveByAcc.set(c.acc, (aliveByAcc.get(c.acc) || 0) + 1) }
    // Vẫn thiếu → lên camp mới bằng bài cũ (chỉ ngày tốt, ≤ max_new_day/ngày)
    while (need > 0 && allowNew && newCount < st.max_new_day - reserveTest && total < st.max_camps) {
      const acc = await pickAccount(b.key, D, aliveByAcc, excl)
      if (!acc) { out.push(`không có tài khoản hợp lệ cho ${b.name}`); break }
      const id = await launchCamp({ bo: b, acc, start: tomorrow, suffix: `B${sc.length + 1 + (newCount - newToday)}`, kieu: b.state === "TEST" ? "test" : "nhan",
        reason: `Bộ ${b.name} ${STATE_LABEL[b.state]}: cần ${target} camp, đang có ${target - need}`, excl, dry })
      if (!id) break
      newCount++; total++; need--; aliveByAcc.set(acc.id, (aliveByAcc.get(acc.id) || 0) + 1)
      out.push(`lên mới ${b.name} ở ${acc.code}`)
    }
    if (need > 0) out.push(`${b.name} còn thiếu ${need} camp (${!allowNew ? "ngày xấu/dừng tuần" : newCount >= st.max_new_day ? "đủ " + st.max_new_day + " camp mới/ngày" : "chạm trần " + st.max_camps + " camp"})`)
  }
  // 6. Slot test bộ chờ (ngày tốt, tối đa test_per_day bộ/ngày) — ưu tiên prio, rồi % lịch sử thấp
  let testsToday = (await loggedToday("state", today, dry, undefined, "%Chờ test → Đang test%")).length
  const queue = [...B.values()].filter((b) => b.state === "QUEUE" && !b.locked)
    .sort((a, b) => (Number(b.prio || 0) - Number(a.prio || 0)) || (() => { const x = D.sumSet(a.key, addD(today, -DATA_DAYS), today), y = D.sumSet(b.key, addD(today, -DATA_DAYS), today); return pctOf(x.s, x.ds) - pctOf(y.s, y.ds) })())
  for (const b of queue) {
    if (!(allowNew && testsToday < st.test_per_day && newCount < st.max_new_day && total < st.max_camps)) break
    const sc = (D.sets.get(b.key)?.camps || []).map((id) => D.camps.get(id)!)
    const old = sc.filter((c) => !c.retired && c.fb_status === "PAUSED" && c.last && c.last >= addD(today, -14))
    let ok = false
    if (old.length && !(await humanPausedRecently(old[0].id))) { planBat.push(old[0]); ok = true }
    else {
      const acc = await pickAccount(b.key, D, aliveByAcc, excl)
      if (acc) { ok = !!(await launchCamp({ bo: b, acc, start: tomorrow, suffix: `T${sc.length + 1}`, kieu: "test", reason: `Test lại bộ ${b.name} (từng thắng, lâu chưa chạy)`, excl, dry })); if (ok) { newCount++; aliveByAcc.set(acc.id, (aliveByAcc.get(acc.id) || 0) + 1) } }
    }
    if (!ok) continue
    total++; testsToday++
    if (!dry) await pool.query(`UPDATE cv_bo SET state='TEST', state_since=$2, extended=false, note=$3, updated_at=now() WHERE key=$1`, [b.key, tomorrow, "Test lại 1 camp từ 5h"])
    await logRow({ action: "state", bo_key: b.key, reason: `${b.name}: Chờ test → Đang test (1 camp từ 5h ${tomorrow})`, dry })
    out.push(`test lại ${b.name}`)
  }
  // 7. Danh sách bật lại 5h
  for (const c of planBat) await logRow({ action: "plan_bat", camp: c, date: tomorrow, reason: `5h bật lại ở 300k`, dry })
  out.push(`5h sẽ bật lại ${planBat.length} camp; tổng camp ngày mai ~${total}`)
  return { lines: out }
}

// ── 5h: bật lại theo kế hoạch ────────────────────────────────────────────────
export async function runMorning(st: CvBoSetting) {
  const dry = st.dry_run
  const D = await loadData()
  const plan = await loggedToday("plan_bat", D.today, dry)
  let n = 0
  for (const p of plan) {
    const c = D.camps.get(p.campaign_id); if (!c || c.retired) continue
    if (c.fb_status === "ACTIVE") continue
    if (await humanPausedRecently(c.id)) continue
    await doStatus(c, "ACTIVE", "bat", "5h bật lại ở 300k (theo kế hoạch 23h)", dry); n++
  }
  return { resumed: n, planned: plan.length }
}

// ── 21h: báo Telegram ────────────────────────────────────────────────────────
export async function runSummary(st: CvBoSetting, userModule?: any) {
  const D = await loadData(false)
  const today = D.today
  const { rows: acts } = await getPool().query(
    `SELECT action, count(*)::int n FROM cv_bo_log WHERE date = $1 AND dry = $2 AND ok AND action IN ('tang','tat','bat','len','retire') GROUP BY 1`, [today, st.dry_run])
  const { rows: bos } = await getPool().query(`SELECT state, count(*)::int n FROM cv_bo GROUP BY 1`)
  const scope = [...D.camps.values()].filter(inScope)
  const t = scope.reduce((a, c) => { const x = D.sum(c.id, today, today); a.s += x.s; a.o += x.o; a.ds += x.ds; return a }, { s: 0, o: 0, ds: 0 })
  const A = Object.fromEntries(acts.map((r: any) => [r.action, r.n]))
  const text = `🍳 Bộ chảo vàng ${today} tới 21h${st.dry_run ? " (CHẠY THỬ — chỉ ghi, chưa làm thật)" : ""}\n` +
    `Chi ${vnd(t.s)}, ${t.o} đơn, ${fmtPct(t.s, t.ds)}\n` +
    `Thao tác: tăng ${A.tang || 0}, tắt ${A.tat || 0}, bật ${A.bat || 0}, lên mới ${A.len || 0}, loại ${A.retire || 0}\n` +
    `Bộ: ${bos.map((b: any) => `${STATE_LABEL[b.state] || b.state} ${b.n}`).join(", ")}\n` +
    `Chi tiết: /app/tu-scale?tab=bo`
  if (userModule) await notifyTelegramByEmail(userModule, await emailsForMkt(userModule, MKT_NEW), text, "auto_scale").catch(() => {})
  return { text }
}

// ── Điều phối theo giờ (cron 30 phút) ────────────────────────────────────────
export async function runCvBo(userModule?: any, force?: "check" | "night" | "morning" | "summary" | "preview") {
  const st = await getSetting()
  if (force === "preview") {
    // Xem trước lượt 23h với số liệu hiện tại: luôn chạy thử, không ghi DB, không gọi FB ghi
    previewSink = []
    try { const r = await runNight({ ...st, dry_run: true }); return { ...r, would: previewSink } } finally { previewSink = null }
  }
  if (!st.enabled && !force) return { skipped: "tắt" }
  const { date, hour } = vnNow()
  const once = async (mode: string, fn: () => Promise<any>) => {
    if (!force && (await loggedToday("run", date, st.dry_run, undefined, mode)).length) return null
    const r = await fn()
    // Chạy tay (force) không đánh dấu "đã chạy hôm nay" → lượt theo giờ của cron vẫn chạy bình thường
    if (!force) await logRow({ action: "run", reason: mode, detail: r, dry: st.dry_run })
    return r
  }
  if (force === "night" || (!force && hour === 23)) return once("night", () => runNight(st, userModule))
  if (force === "morning" || (!force && hour === 5)) return once("morning", () => runMorning(st))
  if (force === "summary" || (!force && hour === 21)) return once("summary", () => runSummary(st, userModule))
  if (force === "check" || (hour >= 6 && hour <= 20)) return runCheck(st)
  return { skipped: `giờ ${hour}` }
}

/** Danh sách bộ + số liệu cho trang /app/tu-scale?tab=bo */
export async function boOverview() {
  const D = await loadData()
  const today = D.today
  const { rows } = await getPool().query(`SELECT key, name, page_id, posts, state, state_since::text, extended, locked, note, prio, updated_at FROM cv_bo`)
  const sets = rows.map((b: any) => {
    const camps = (D.sets.get(b.key)?.camps || []).map((id) => D.camps.get(id)!).filter(Boolean)
    const w7 = D.sumSet(b.key, addD(today, -7), addD(today, -1)), all = D.sumSet(b.key, addD(today, -DATA_DAYS), addD(today, -1)), t = D.sumSet(b.key, today, today)
    return { ...b, page: PAGE_CODE[b.page_id] || b.page_id, target: TARGET[b.state] ?? 0, label: STATE_LABEL[b.state] || b.state,
      alive: camps.filter((c) => c.fb_status === "ACTIVE" && !c.retired).length, camps: camps.length,
      last: camps.map((c) => c.last).filter(Boolean).sort().pop() || null, today: t, w7, all }
  }).sort((a: any, b: any) => (TARGET[b.state] ?? 0) - (TARGET[a.state] ?? 0) || b.all.ds - a.all.ds)
  const { rows: logs } = await getPool().query(`SELECT * FROM cv_bo_log WHERE action <> 'run' ORDER BY created_at DESC LIMIT 300`)
  return { setting: await getSetting(), sets, logs, today }
}
