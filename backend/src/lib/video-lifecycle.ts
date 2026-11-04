import { getPool } from "./db"
import { MKT_ORDER_FILTER_SQL, ORDER_REVENUE_SQL } from "./mkt-today"
import { notifyTelegramByEmail } from "./notify"

/**
 * Vòng đời VIDEO: Test → Win → Scale (user chốt 4/11/2026, bằng chứng ở output/ads-autopilot/care/KINH_NGHIEM.md mục 13–17).
 * Tự scale lo ngân sách từng camp trong ngày; file này lo VIDEO được chạy ở bao nhiêu camp, video nào phải tắt.
 *
 * Video = sản phẩm (đầu tên camp) + mã video (đầu tên ad, trước " - "). Cộng MỌI camp XUANLT/ANHTD.
 *  - Video MỚI (lần chi đầu tiên ở mọi MKT ≤ 14 ngày), đã chạy ≥ 1 ngày trọn — luật TEST, tính trọn đời, đếm MỌI SỐ (kể cả nháp):
 *      chi ≥ 300k mà 0 số → tắt (0/24 video thành thắng) · chi ≥ 800k mà ≤ 1 số → tắt (0/13).
 *  - Video CŨ — theo 7 ngày tới hôm qua (đơn hợp lệ): chi ≥ 300k mà 0 đơn hoặc > 50% → YẾU, tắt mọi camp (ngày sau 47%);
 *      35–50% → GIỮ 1 camp (ngày sau 31–34%); ≤ 35% & ≥ 5 đơn → SCALE tối đa 6 camp; ≤ 35% còn lại → WIN tối đa 3 camp.
 *  - Vượt số camp tối đa: giữ camp tốt nhất (% 7 ngày của video ở chính camp đó); camp < 3 ngày tuổi không bị cắt vì thừa.
 * Tắt = tắt ad của video trong camp; ad đó là ad cuối cùng của camp → tắt camp + gỡ Tự scale.
 * Người bật lại ad hệ thống đã tắt (≤ 3 ngày) → không tắt lại, chỉ báo.
 * VIDEO_LIFECYCLE=off (tắt hẳn) | dry (chỉ ghi + báo, không tắt) — mặc định on.
 */

const GRAPH = "https://graph.facebook.com/v25.0"
const MKTS = ["XUANLT", "ANHTD"]
const AD_KEY = `split_part(campaign_name, '_', 1) || '|' || split_part(ad_name, ' - ', 1)`
const ORDER_KEY = `split_part(raw->>'p_utm_source', '_', 1) || '|' || split_part(raw->>'p_utm_content', ' - ', 1)`
const ORDER_MKT = `raw->>'p_utm_source' ~ '_(XUANLT|ANHTD)_'`

export const VL = {
  NEW_DAYS: 14,
  TEST_KILL_SPEND: 300_000,      // 0 số
  TEST_KILL2_SPEND: 800_000,     // ≤ 1 số
  STUCK_DAYS: 5,                 // chạy ≥ 5 ngày mà chưa tới 300k → bị lấn
  WEAK_MIN_SPEND: 300_000,
  WEAK_PCT: 50,
  HOLD_PCT: 35,
  SCALE_ORDERS: 5,
  WIN_ORDERS: 2,
  CAP: { WIN: 3, SCALE: 6, HOLD: 1, WEAK: 0 } as Record<string, number>,
  PROTECT_DAYS: 3,
  MAX_ACTIONS: 15,
}

type Agg = { s: number; leads: number; o: number; ds: number }
export type VideoStat = { key: string; first_all: string; first: string; days: number; life: Agg; w7: Agg }
export type Stage = "TEST" | "WIN" | "SCALE" | "HOLD" | "WEAK" | "IDLE"
export type Verdict = { stage: Stage; isNew: boolean; kill: string | null; stuck: boolean; pct: number | null; note: string }

const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const k = (n: number) => `${Math.round(n / 1000)}k`
const pctOf = (s: number, ds: number) => (ds > 0 ? Math.round((s / ds) * 100) : null)
const token = () => process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""

/** Số liệu video (keys = null → mọi video có chi trong 60 ngày). */
export async function videoStats(keys: string[] | null): Promise<Map<string, VideoStat>> {
  const pool = getPool()
  const today = vnToday(), from = addDays(today, -60), w7 = addDays(today, -7)
  const kf = keys ? `AND ${AD_KEY} = ANY($2)` : ""
  const kfo = keys ? `AND ${ORDER_KEY} = ANY($2)` : ""
  const args = keys ? [from, keys] : [from]
  const { rows: ad } = await pool.query(
    `SELECT ${AD_KEY} v, min(date)::text f_all,
            min(date) FILTER (WHERE mkt_name = ANY($${keys ? 3 : 2}))::text f,
            count(DISTINCT date) FILTER (WHERE mkt_name = ANY($${keys ? 3 : 2}) AND spend > 0)::int nd,
            COALESCE(sum(spend) FILTER (WHERE mkt_name = ANY($${keys ? 3 : 2})), 0)::bigint s,
            COALESCE(sum(spend) FILTER (WHERE mkt_name = ANY($${keys ? 3 : 2}) AND date >= '${w7}' AND date < '${today}'), 0)::bigint s7
       FROM mkt_ads_cost_ad WHERE deleted_at IS NULL AND date >= $1 ${kf} GROUP BY 1`,
    [...args, MKTS]
  )
  const { rows: od } = await pool.query(
    `SELECT ${ORDER_KEY} v, count(*)::int leads,
            count(*) FILTER (WHERE ${MKT_ORDER_FILTER_SQL} AND status NOT IN (-2, 7))::int o,
            COALESCE(sum(${ORDER_REVENUE_SQL}) FILTER (WHERE ${MKT_ORDER_FILTER_SQL} AND status NOT IN (-2, 7)), 0)::bigint ds,
            count(*) FILTER (WHERE ${MKT_ORDER_FILTER_SQL} AND status NOT IN (-2, 7) AND (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= '${w7}' AND (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < '${today}')::int o7,
            COALESCE(sum(${ORDER_REVENUE_SQL}) FILTER (WHERE ${MKT_ORDER_FILTER_SQL} AND status NOT IN (-2, 7) AND (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= '${w7}' AND (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < '${today}'), 0)::bigint ds7
       FROM pancake_order WHERE deleted_at IS NULL AND ${ORDER_MKT} AND pancake_created_at >= $1::date ${kfo} GROUP BY 1`,
    args
  )
  // Lần chi đầu tiên ở MỌI MKT, mọi thời gian — video cũ đã chứng minh mà lên lại (vd hộp nhựa "4" của Kiên từ tháng 8) không phải video mới
  const { rows: fa } = await pool.query(
    `SELECT ${AD_KEY} v, min(date)::text f FROM mkt_ads_cost_ad WHERE deleted_at IS NULL AND spend > 0 ${keys ? `AND ${AD_KEY} = ANY($1)` : ""} GROUP BY 1`,
    keys ? [keys] : []
  )
  const FA = new Map(fa.map((r: any) => [r.v, r.f]))
  const O = new Map(od.map((r: any) => [r.v, r]))
  const out = new Map<string, VideoStat>()
  for (const r of ad) {
    if (!r.f) continue
    const o: any = O.get(r.v) || {}
    out.set(r.v, {
      key: r.v, first_all: FA.get(r.v) || r.f_all, first: r.f, days: r.nd,
      life: { s: Number(r.s), leads: o.leads || 0, o: o.o || 0, ds: Number(o.ds || 0) },
      w7: { s: Number(r.s7), leads: 0, o: o.o7 || 0, ds: Number(o.ds7 || 0) },
    })
  }
  return out
}

export function classify(v: VideoStat, today = vnToday()): Verdict {
  const isNew = v.first_all >= addDays(today, -VL.NEW_DAYS)
  if (isNew) {
    const L = v.life, pct = pctOf(L.s, L.ds)
    const stage: Stage = L.o >= VL.SCALE_ORDERS && pct !== null && pct <= VL.HOLD_PCT ? "SCALE"
      : L.o >= VL.WIN_ORDERS && pct !== null && pct <= VL.HOLD_PCT ? "WIN" : "TEST"
    let kill: string | null = null
    if (v.first < today) {
      if (L.s >= VL.TEST_KILL2_SPEND && L.leads <= 1) kill = `video mới chi ${k(L.s)}, ${L.leads} số (mốc 800k cần ≥ 2)`
      else if (L.s >= VL.TEST_KILL_SPEND && L.leads === 0) kill = `video mới chi ${k(L.s)}, 0 số (mốc 300k)`
    }
    const stuck = !kill && v.days >= VL.STUCK_DAYS && L.s < VL.TEST_KILL_SPEND
    return { stage, isNew, kill, stuck, pct, note: `trọn đời ${k(L.s)} · ${L.leads} số · ${L.o} đơn · ${pct ?? "–"}%` }
  }
  const W = v.w7, pct = pctOf(W.s, W.ds)
  const note = `7 ngày ${k(W.s)} · ${W.o} đơn · ${pct ?? "–"}%`
  if (W.s < VL.WEAK_MIN_SPEND) return { stage: "IDLE", isNew, kill: null, stuck: false, pct, note }
  if (W.o === 0 || pct === null || pct > VL.WEAK_PCT) return { stage: "WEAK", isNew, kill: `video 7 ngày ${k(W.s)}, ${W.o} đơn, ${pct ?? "–"}% (> ${VL.WEAK_PCT}% / 0 đơn)`, stuck: false, pct, note }
  if (pct > VL.HOLD_PCT) return { stage: "HOLD", isNew, kill: null, stuck: false, pct, note }
  return { stage: W.o >= VL.SCALE_ORDERS ? "SCALE" : "WIN", isNew, kill: null, stuck: false, pct, note }
}

/** Video chính của camp (chi nhiều nhất 14 ngày) đã hỏng → lý do để Tự scale KHÔNG bật lại lúc 5h. */
export async function videoBlockReason(campaignId: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT ${AD_KEY} v, sum(spend) s FROM mkt_ads_cost_ad WHERE deleted_at IS NULL AND campaign_id = $1 AND date >= current_date - 14 GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
    [campaignId]
  )
  if (!rows[0]) return null
  const st = (await videoStats([rows[0].v])).get(rows[0].v)
  if (!st) return null
  const c = classify(st)
  return c.kill ? `${rows[0].v.split("|")[1]} — ${c.kill}` : null
}

async function fb(method: "GET" | "POST", path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?"
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${token()}`, { method })
  return r.json()
}

async function ensureTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS video_lifecycle_log (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      video_key TEXT NOT NULL, stage TEXT, kind TEXT NOT NULL,
      campaign_id TEXT, campaign_name TEXT, ad_id TEXT,
      reason TEXT, camp_paused BOOLEAN DEFAULT false, dry_run BOOLEAN DEFAULT false, success BOOLEAN DEFAULT true, error TEXT
    )`)
  await getPool().query(`CREATE INDEX IF NOT EXISTS video_lifecycle_log_ad_idx ON video_lifecycle_log (ad_id, created_at)`)
}

type LiveAd = { ad_id: string; ad_name: string; key: string; camp_id: string; camp_name: string; mkt: string; camp_first: string; live_in_camp: number }
type Action = { key: string; stage: Stage; kind: "test_kill" | "weak" | "excess"; ad: LiveAd; reason: string }

/** Camp đang bật của XUANLT/ANHTD và các ad đang chạy (FB là nguồn sự thật). */
async function liveAds(): Promise<LiveAd[]> {
  const { rows } = await getPool().query(
    `SELECT campaign_id, max(campaign_name) n, max(mkt_name) m, min(date)::text f FROM mkt_ads_cost
      WHERE deleted_at IS NULL AND mkt_name = ANY($1) AND date >= current_date - 30 GROUP BY 1
     HAVING max(date) >= current_date - 2`,
    [MKTS]
  )
  const out: LiveAd[] = []
  for (const c of rows) {
    if (/MESS|XAKHO/i.test(c.n || "")) continue
    const r = await fb("GET", `/${c.campaign_id}?fields=name,effective_status,ads.limit(50){id,name,effective_status}`).catch(() => null)
    if (!r || r.error || !["ACTIVE", "IN_PROCESS"].includes(r.effective_status)) continue
    const live = (r.ads?.data || []).filter((a: any) => ["ACTIVE", "PENDING_REVIEW", "IN_PROCESS", "PREAPPROVED"].includes(a.effective_status))
    for (const a of live) out.push({
      ad_id: a.id, ad_name: a.name, key: `${String(r.name).split("_")[0]}|${String(a.name).split(" - ")[0]}`,
      camp_id: c.campaign_id, camp_name: r.name, mkt: c.m, camp_first: c.f, live_in_camp: live.length,
    })
  }
  return out
}

/** % 7 ngày của video ở từng camp — chọn camp giữ lại khi thừa. */
async function campVideo7(campIds: string[]) {
  if (!campIds.length) return new Map<string, { s: number; o: number; ds: number }>()
  const pool = getPool()
  const { rows: a } = await pool.query(
    `SELECT campaign_id c, ${AD_KEY} v, sum(spend)::bigint s FROM mkt_ads_cost_ad WHERE deleted_at IS NULL AND campaign_id = ANY($1) AND date >= current_date - 7 AND date < current_date GROUP BY 1,2`, [campIds])
  const { rows: o } = await pool.query(
    `SELECT raw->>'p_utm_campaign' c, ${ORDER_KEY} v, count(*)::int o, sum(${ORDER_REVENUE_SQL})::bigint ds FROM pancake_order
      WHERE ${MKT_ORDER_FILTER_SQL} AND status NOT IN (-2, 7) AND raw->>'p_utm_campaign' = ANY($1) AND pancake_created_at >= current_date - 7 AND pancake_created_at < current_date GROUP BY 1,2`, [campIds])
  const m = new Map<string, { s: number; o: number; ds: number }>()
  for (const r of a) m.set(`${r.c}#${r.v}`, { s: Number(r.s), o: 0, ds: 0 })
  for (const r of o) { const z = m.get(`${r.c}#${r.v}`); if (z) { z.o = r.o; z.ds = Number(r.ds) } }
  return m
}

export async function planVideoLifecycle() {
  const today = vnToday()
  const ads = await liveAds()
  const keys = [...new Set(ads.map((a) => a.key))]
  const stats = await videoStats(null)
  const cv = await campVideo7([...new Set(ads.map((a) => a.camp_id))])
  const actions: Action[] = []
  const videos: { key: string; v: VideoStat | null; c: Verdict | null; camps: number; cap: number | null }[] = []
  for (const key of keys) {
    const mine = ads.filter((a) => a.key === key)
    const v = stats.get(key) || null
    const c = v ? classify(v, today) : null
    const campIds = [...new Set(mine.map((a) => a.camp_id))]
    const cap = c ? (c.kill ? 0 : VL.CAP[c.stage] ?? null) : null
    videos.push({ key, v, c, camps: campIds.length, cap })
    if (!c) continue
    if (c.kill) { for (const ad of mine) actions.push({ key, stage: c.stage, kind: c.isNew ? "test_kill" : "weak", ad, reason: c.kill }); continue }
    if (cap == null || campIds.length <= cap) continue
    // Thừa camp: camp non (< 3 ngày) luôn giữ; còn lại xếp theo % 7 ngày của video ở camp đó
    const young = (cid: string) => (mine.find((a) => a.camp_id === cid)!.camp_first > addDays(today, -VL.PROTECT_DAYS))
    const score = (cid: string) => { const z = cv.get(`${cid}#${key}`); return z && z.ds > 0 ? z.s / z.ds : z && z.s > 0 ? 9 : 5 }
    const old = campIds.filter((cid) => !young(cid)).sort((a, b) => score(a) - score(b))
    const room = Math.max(0, cap - campIds.filter(young).length)
    for (const cid of old.slice(room)) for (const ad of mine.filter((a) => a.camp_id === cid)) {
      const z = cv.get(`${cid}#${key}`)
      actions.push({ key, stage: c.stage, kind: "excess", ad, reason: `video ${c.stage} (${c.note}) tối đa ${cap} camp, đang ${campIds.length} — camp này 7 ngày ${z ? `${k(z.s)} · ${z.o} đơn · ${pctOf(z.s, z.ds) ?? "–"}%` : "chưa có số"}` })
    }
  }
  return { today, ads, videos, actions }
}

const STAGE_VN: Record<string, string> = { TEST: "TEST", WIN: "WIN", SCALE: "SCALE", HOLD: "GIỮ 1", WEAK: "YẾU", IDLE: "ít chi" }

export async function runVideoLifecycle(opts: { userModule?: any; emails?: string[]; dry?: boolean; report?: boolean } = {}) {
  const mode = String(process.env.VIDEO_LIFECYCLE ?? "on").toLowerCase()
  if (mode === "off") return { skipped: true }
  await ensureTable()
  const dry = opts.dry || mode === "dry"
  const pool = getPool()
  const plan = await planVideoLifecycle()
  const done: { a: Action; ok: boolean; campPaused: boolean; err: string | null; skipped?: string }[] = []
  const pausedInCamp = new Map<string, number>()
  if (!opts.report) for (const a of plan.actions.slice(0, VL.MAX_ACTIONS)) {
    // Người đã bật lại ad hệ thống tắt trong 3 ngày → tôn trọng, chỉ báo
    const { rows: prev } = await pool.query(
      `SELECT 1 FROM video_lifecycle_log WHERE ad_id = $1 AND success AND NOT dry_run AND created_at > now() - interval '3 days' LIMIT 1`, [a.ad.ad_id])
    if (prev.length) { done.push({ a, ok: false, campPaused: false, err: null, skipped: "người đã bật lại sau khi hệ thống tắt — không tắt lại" }); continue }
    const lastAd = a.ad.live_in_camp - (pausedInCamp.get(a.ad.camp_id) || 0) <= 1
    let ok = true, err: string | null = null, campPaused = false
    if (!dry) {
      const r = await fb("POST", `/${a.ad.ad_id}?status=PAUSED`).catch((e) => ({ error: { message: e.message } }))
      ok = !!r?.success && !r?.error
      err = ok ? null : String(r?.error?.message || "FB error").slice(0, 300)
      if (ok && lastAd) {
        const rc = await fb("POST", `/${a.ad.camp_id}?status=PAUSED`).catch(() => null)
        campPaused = !!rc?.success
        await pool.query(`UPDATE auto_scale_camp SET enabled = false, updated_at = now() WHERE campaign_id = $1`, [a.ad.camp_id]).catch(() => {})
        await pool.query(
          `INSERT INTO camp_action_log (campaign_id, campaign_name, action, old_value, new_value, source, user_email, fb_response, success)
           VALUES ($1,$2,'pause','{"status":"ACTIVE"}'::jsonb,'{"status":"PAUSED"}'::jsonb,'video_lifecycle','video-lifecycle',$3::jsonb,$4)`,
          [a.ad.camp_id, a.ad.camp_name, JSON.stringify(rc || {}), campPaused]
        ).catch(() => {})
      }
    }
    if (ok) pausedInCamp.set(a.ad.camp_id, (pausedInCamp.get(a.ad.camp_id) || 0) + 1)
    await pool.query(
      `INSERT INTO video_lifecycle_log (video_key, stage, kind, campaign_id, campaign_name, ad_id, reason, camp_paused, dry_run, success, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [a.key, a.stage, a.kind, a.ad.camp_id, a.ad.camp_name, a.ad.ad_id, a.reason, campPaused, dry, ok, err]
    )
    done.push({ a, ok, campPaused, err })
  }
  const text = opts.report ? await dailyReport(plan) : actionText(done, dry, plan.actions.length)
  if (text && opts.userModule && opts.emails?.length) await notifyTelegramByEmail(opts.userModule, opts.emails, text, "video_lifecycle").catch(() => {})
  return { dry, plan: { videos: plan.videos.length, ads: plan.ads.length, actions: plan.actions.length }, done: done.map((d) => ({ ...d.a, ok: d.ok, camp_paused: d.campPaused, err: d.err, skipped: d.skipped })), text }
}

function actionText(done: { a: Action; ok: boolean; campPaused: boolean; err: string | null; skipped?: string }[], dry: boolean, total: number) {
  if (!done.length) return ""
  const kindVN = { test_kill: "TEST trượt", weak: "video YẾU", excess: "thừa camp" }
  const lines = done.map((d) => `• ${d.a.key.split("|")[1]} (${kindVN[d.a.kind]}) — ${d.a.ad.camp_name.split("_").slice(1, 2).join("")} ${d.a.ad.camp_name.split("_").slice(-1)[0]}: ${d.skipped ? `BỎ QUA (${d.skipped})` : d.ok ? (d.campPaused ? "tắt ad + tắt camp (ad cuối)" : "tắt ad") : `LỖI ${d.err}`}\n   ${d.a.reason}`)
  return `🎬 Vòng đời video — ${dry ? "CHẠY THỬ (chưa tắt thật)" : "đã tự tắt"} ${done.length}${total > done.length ? `/${total}` : ""} ad\n${lines.join("\n")}`
}

async function dailyReport(plan: Awaited<ReturnType<typeof planVideoLifecycle>>) {
  const { rows: acts } = await getPool().query(
    `SELECT video_key, kind, count(*)::int n, bool_or(camp_paused) cp FROM video_lifecycle_log WHERE created_at >= (current_date::timestamp - interval '7 hours') AND success AND NOT dry_run GROUP BY 1,2`)
  const tests = plan.videos.filter((x) => x.c?.isNew).sort((a, b) => (b.v?.life.s || 0) - (a.v?.life.s || 0))
  const testSpend = tests.reduce((q, x) => q + (x.v?.life.s || 0), 0)
  const name = (key: string) => `${key.split("|")[1]} (${key.split("|")[0].replace("PHVVN", "")})`
  const L: string[] = [`📊 Vòng đời video — ${plan.today}`]
  L.push(`\nTEST (video mới ≤ ${VL.NEW_DAYS} ngày): ${tests.length} video, đã chi ${k(testSpend)}`)
  for (const x of tests.slice(0, 15)) {
    const s = x.v!.life.s, to = s < VL.TEST_KILL_SPEND ? `còn ${k(VL.TEST_KILL_SPEND - s)} tới mốc 300k` : s < VL.TEST_KILL2_SPEND ? `còn ${k(VL.TEST_KILL2_SPEND - s)} tới mốc 800k` : "qua mốc 800k"
    L.push(`• ${name(x.key)} ${STAGE_VN[x.c!.stage]} — ${x.c!.note} · ${x.camps} camp · ${to}${x.c!.stuck ? " · ⚠️ BỊ LẤN: tách 1 camp 1 video" : ""}${x.c!.stage === "WIN" ? " · ✅ đạt → lên 2–3 camp" : ""}`)
  }
  const scale = plan.videos.filter((x) => x.c && !x.c.isNew && x.c.stage !== "IDLE").sort((a, b) => (a.c!.pct ?? 99) - (b.c!.pct ?? 99))
  L.push(`\nWIN / SCALE / GIỮ (video cũ, 7 ngày):`)
  for (const x of scale) L.push(`• ${name(x.key)} ${STAGE_VN[x.c!.stage]} — ${x.c!.note} · ${x.camps}/${x.cap ?? "–"} camp${x.cap != null && x.camps < x.cap && (x.c!.stage === "SCALE" || x.c!.stage === "WIN") ? ` · còn thêm được ${x.cap - x.camps}` : ""}`)
  if (acts.length) { L.push(`\nHôm nay hệ thống đã tắt:`); for (const a of acts) L.push(`• ${name(a.video_key)} — ${a.kind === "test_kill" ? "TEST trượt" : a.kind === "weak" ? "video YẾU" : "thừa camp"}: ${a.n} ad${a.cp ? " (có tắt camp)" : ""}`) }
  if (plan.actions.length) L.push(`\nĐang chờ tắt ở lượt 9h mai: ${plan.actions.length} ad`)
  return L.join("\n")
}
