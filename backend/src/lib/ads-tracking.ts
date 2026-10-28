/**
 * Theo dõi bộ video: Hub (mkt_video) → camp trên tài khoản/page → chạy → đánh giá theo luật vòng đời (ads_rule "camp-vong-doi").
 * Số liệu suy ra từ mkt_ads_cost (camp-ngày), mkt_ads_cost_ad (ad-ngày, mã VD + id post trong tên ad) và pancake_order (utm);
 * ads_launch bổ sung thông tin lúc lên camp (kiểu lên, page, lý do, seeding) cho camp lên qua công cụ của AI.
 */
import { getPool } from "./db"

let ready: Promise<void> | null = null
export function ensureTrackingTables() {
  if (!ready) {
    ready = getPool().query(`
      CREATE TABLE IF NOT EXISTS ads_launch (
        campaign_id TEXT PRIMARY KEY,
        campaign_name TEXT,
        product_code TEXT,
        mkt_name TEXT,
        account_id TEXT,
        page_id TEXT,
        mode TEXT,                 -- test | nhan | scale_ngang | doi_page | khac
        videos TEXT[],
        post_ids TEXT[],
        start_at TIMESTAMPTZ,
        rule_id INT,
        exclusions JSONB,
        seeding JSONB,
        reason TEXT,
        launched_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `).then(() => undefined).catch((e) => { ready = null; throw e })
  }
  return ready
}

// Same as DON_HOP_LE in auto-scale.ts — new, not duplicate, not draft; independent of sale processing.
const ORDER_FILTER = `deleted_at IS NULL AND status <> 7
  AND NOT (tags @> '[{"name":"Đơn trùng"}]'::jsonb)
  AND NOT (tags @> '[{"name":"Đơn nháp"}]'::jsonb)`

const PAGE_CODES: [RegExp, string][] = [[/_MĐGD_/, "Mê Đồ Gia Dụng"], [/_SMH_/, "SmartHome"], [/_TICS_/, "Tiện Ích Cuộc Sống"], [/_VIETMATE_/, "Vietmate"]]
const accLabel = (name: string) => (name.match(/_(ADS\d{3})_/) || [])[1] || "?"
const pageLabel = (name: string) => (PAGE_CODES.find(([re]) => re.test(name)) || [])[1] || "khác"
const pct = (sp: number, ds: number) => (ds > 0 ? Math.round((sp / ds) * 100) : null)

type Day = { date: string; spend: number; orders: number; ds: number }

/**
 * Giai đoạn theo luật camp-vong-doi (user chốt 19/10/2026):
 *  test 3 ngày đầu → thắng nếu ≥ 2 camp-ngày ≤25% & ≥2 đơn trong 3 ngày đầu; trượt nếu 3 ngày 0 đơn cả bộ hoặc ≥900k & >45%;
 *  mòn: % 7 ngày gần nhất và 7 ngày trước đó đều >35%; dừng: không còn camp chạy.
 */
function stageOf(set: { first: string; campDays: Record<string, Day[]>; active: number }, today: string) {
  const age = Math.round((Date.parse(today) - Date.parse(set.first)) / 864e5) + 1
  const all = Object.values(set.campDays).flat()
  const first3 = all.filter((d) => (Date.parse(d.date) - Date.parse(set.first)) / 864e5 < 3)
  const winDays = first3.filter((d) => d.orders >= 2 && d.spend / Math.max(d.ds, 1) <= 0.25).length
  const sum = (xs: Day[]) => xs.reduce((a, d) => ({ sp: a.sp + d.spend, ds: a.ds + d.ds, n: a.n + d.orders }), { sp: 0, ds: 0, n: 0 })
  const f3 = sum(first3)
  const back = (n: number) => new Date(Date.parse(today) - n * 864e5).toISOString().slice(0, 10)
  const w1 = sum(all.filter((d) => d.date > back(7))), w2 = sum(all.filter((d) => d.date <= back(7) && d.date > back(14)))
  if (!set.active) return { stage: "dung", reason: "Không còn camp nào đang chạy" }
  if (winDays >= 2) {
    if (age > 14 && pct(w1.sp, w1.ds) !== null && pct(w1.sp, w1.ds)! > 35 && pct(w2.sp, w2.ds) !== null && pct(w2.sp, w2.ds)! > 35)
      return { stage: "mon", reason: `7 ngày ${pct(w1.sp, w1.ds)}%, tuần trước ${pct(w2.sp, w2.ds)}% (> 35% hai tuần liền)` }
    return { stage: Object.keys(set.campDays).length > 3 ? "scale" : "thang", reason: `${winDays} camp-ngày ≤25% với ≥2 đơn trong 3 ngày đầu` }
  }
  if (age >= 3 && f3.n === 0) return { stage: "truot", reason: "3 ngày đầu 0 đơn" }
  if (f3.sp >= 900_000 && f3.sp / Math.max(f3.ds, 1) > 0.45) return { stage: "truot", reason: `3 ngày đầu chi ${Math.round(f3.sp / 1000)}k, ${pct(f3.sp, f3.ds) ?? "∞"}%` }
  if (age <= 3) return { stage: "test", reason: `Ngày ${age}/3 — ${f3.n} đơn, ${winDays} camp-ngày đạt` }
  if (age > 14 && pct(w1.sp, w1.ds) !== null && pct(w1.sp, w1.ds)! > 35 && pct(w2.sp, w2.ds) !== null && pct(w2.sp, w2.ds)! > 35)
    return { stage: "mon", reason: `7 ngày ${pct(w1.sp, w1.ds)}%, tuần trước ${pct(w2.sp, w2.ds)}%` }
  return { stage: "theo-doi", reason: `Không đạt chuẩn thắng 3 ngày đầu (${winDays} camp-ngày đạt) — chấm theo ngày` }
}

export async function videoTracking(opts: { days: number; mkts: string[] }) {
  await ensureTrackingTables()
  const pool = getPool()
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const from = new Date(Date.parse(today) - (opts.days - 1) * 864e5).toISOString().slice(0, 10)
  // camp có chi tiêu trong cửa sổ, kèm toàn bộ lịch sử (để biết ngày đầu)
  const { rows: camps } = await pool.query(
    `SELECT campaign_id, max(campaign_name) campaign_name, max(mkt_name) mkt_name, max(ad_account_id) account_id, min(date)::text first_date,
            max(date)::text last_date,
            -- đang chạy = trạng thái ở ngày có dữ liệu gần nhất (qua 0h ngày mới chưa có dòng) và không quá 1 ngày
            ((array_agg(effective_status ORDER BY date DESC))[1] = 'ACTIVE' AND max(date) >= $3::date - 1) active_today
       FROM mkt_ads_cost WHERE deleted_at IS NULL AND spend > 0 AND mkt_name = ANY($1)
      GROUP BY campaign_id HAVING max(date) >= $2::date`,
    [opts.mkts, from, today]
  )
  const ids = camps.map((c: any) => c.campaign_id)
  if (!ids.length) return { sets: [], today }
  const [{ rows: cd }, { rows: od }, { rows: ad }, { rows: aod }, { rows: launches }, { rows: hub }, { rows: seeded }] = await Promise.all([
    pool.query(`SELECT campaign_id, date::text d, sum(spend)::float sp, max(effective_status) st FROM mkt_ads_cost WHERE campaign_id = ANY($1) AND deleted_at IS NULL GROUP BY 1,2`, [ids]),
    pool.query(`SELECT raw->>'p_utm_campaign' cid, (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text d, count(*)::int n, coalesce(sum(cod_amount),0)::float ds
                  FROM pancake_order WHERE raw->>'p_utm_campaign' = ANY($1) AND ${ORDER_FILTER} GROUP BY 1,2`, [ids]),
    pool.query(`SELECT campaign_id, vd_code, max(ad_name) ad_name, sum(spend)::float sp, min(date)::text first_date FROM mkt_ads_cost_ad
                 WHERE campaign_id = ANY($1) AND deleted_at IS NULL GROUP BY 1,2`, [ids]),
    pool.query(`SELECT raw->>'p_utm_campaign' cid, substring(raw->>'p_utm_content' from '^(VD[0-9]+)') vd, count(*)::int n, coalesce(sum(cod_amount),0)::float ds
                  FROM pancake_order WHERE raw->>'p_utm_campaign' = ANY($1) AND ${ORDER_FILTER} GROUP BY 1,2`, [ids]),
    pool.query(`SELECT * FROM ads_launch WHERE campaign_id = ANY($1)`, [ids]),
    pool.query(`SELECT vd_code, maker, video_type, product_code, created_at::date::text c, left(note,120) note FROM mkt_video`),
    pool.query(`SELECT post_id, status FROM ads_seeding_log`).catch(() => ({ rows: [] as any[] })),
  ])
  // Camp đang gắn Tự scale (bật) mà hôm nay bị phanh vẫn tính là đang chạy — 5h sáng tự bật lại
  const { rows: ts } = await pool.query(`SELECT campaign_id FROM auto_scale_camp WHERE enabled AND campaign_id = ANY($1)`, [ids])
  const tsOn = new Set(ts.map((r: any) => r.campaign_id))
  for (const c of camps) if (tsOn.has(c.campaign_id) && c.last_date >= new Date(Date.parse(today) - 2 * 864e5).toISOString().slice(0, 10)) c.active_today = true
  const hubBy = new Map(hub.map((h: any) => [h.vd_code, h]))
  const seededPosts = new Set(seeded.filter((s: any) => s.status === "done" || s.status === "skipped").map((s: any) => String(s.post_id).split("_")[1]))
  const launchBy = new Map(launches.map((l: any) => [l.campaign_id, l]))
  const ordBy = new Map<string, any[]>(); for (const o of od) ordBy.set(o.cid, [...(ordBy.get(o.cid) || []), o])

  const sets = new Map<string, any>()
  for (const c of camps) {
    const ads = ad.filter((a: any) => a.campaign_id === c.campaign_id && a.vd_code)
    const vds = [...new Set(ads.map((a: any) => a.vd_code as string))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
    if (!vds.length) continue
    const key = vds.join("+")
    const days: Day[] = cd.filter((x: any) => x.campaign_id === c.campaign_id).map((x: any) => {
      const o = (ordBy.get(c.campaign_id) || []).find((y: any) => y.d === x.d)
      return { date: x.d, spend: x.sp, orders: o?.n || 0, ds: o?.ds || 0 }
    })
    const l = launchBy.get(c.campaign_id)
    const posts = ads.map((a: any) => (String(a.ad_name).match(/ - (\d{10,})/) || [])[1]).filter(Boolean)
    const s = sets.get(key) || { key, videos: vds, first: c.first_date, campDays: {}, camps: [], active: 0 }
    s.first = s.first < c.first_date ? s.first : c.first_date
    s.campDays[c.campaign_id] = days
    if (c.active_today) s.active++
    const tot = days.reduce((a, d) => ({ sp: a.sp + d.spend, ds: a.ds + d.ds, n: a.n + d.orders }), { sp: 0, ds: 0, n: 0 })
    s.camps.push({
      campaign_id: c.campaign_id, name: c.campaign_name, mkt: c.mkt_name, account: accLabel(c.campaign_name), page: pageLabel(c.campaign_name),
      first_date: c.first_date, active: !!c.active_today, mode: l?.mode || null, reason: l?.reason || null,
      seeding: posts.length ? (posts.every((p: string) => seededPosts.has(p)) ? "có" : "chưa ghi nhận") : "—",
      spend: tot.sp, orders: tot.n, ds: tot.ds, pct: pct(tot.sp, tot.ds),
      last3: days.filter((d) => d.date > new Date(Date.parse(today) - 3 * 864e5).toISOString().slice(0, 10)),
    })
    sets.set(key, s)
  }
  const out = [...sets.values()].map((s) => {
    const all: Day[] = Object.values(s.campDays).flat() as Day[]
    const win = (n: number) => {
      const since = new Date(Date.parse(today) - (n - 1) * 864e5).toISOString().slice(0, 10)
      const t = all.filter((d) => d.date >= since).reduce((a, d) => ({ sp: a.sp + d.spend, ds: a.ds + d.ds, n: a.n + d.orders }), { sp: 0, ds: 0, n: 0 })
      return { spend: t.sp, orders: t.n, ds: t.ds, pct: pct(t.sp, t.ds) }
    }
    const total = all.reduce((a, d) => ({ sp: a.sp + d.spend, ds: a.ds + d.ds, n: a.n + d.orders }), { sp: 0, ds: 0, n: 0 })
    const st = stageOf(s, today)
    const videos = s.videos.map((v: string) => {
      const sp = ad.filter((a: any) => a.vd_code === v && s.camps.some((c: any) => c.campaign_id === a.campaign_id)).reduce((x: number, a: any) => x + a.sp, 0)
      const o = aod.filter((a: any) => a.vd === v && s.camps.some((c: any) => c.campaign_id === a.cid)).reduce((x: any, a: any) => ({ n: x.n + a.n, ds: x.ds + a.ds }), { n: 0, ds: 0 })
      const h: any = hubBy.get(v)
      return { vd: v, spend: sp, orders: o.n, ds: o.ds, pct: pct(sp, o.ds), maker: h?.maker || null, hub_date: h?.c || null, type: h?.video_type || null, note: h?.note || null }
    })
    const accPage = [...new Set(s.camps.filter((c: any) => c.active).map((c: any) => `${c.account} × ${c.page}`))]
    return {
      key: s.key, videos, first_date: s.first, stage: st.stage, stage_reason: st.reason,
      camps_total: s.camps.length, camps_active: s.active, acc_page_active: accPage,
      d3: win(3), d7: win(7), all: { spend: total.sp, orders: total.n, ds: total.ds, pct: pct(total.sp, total.ds) },
      camps: s.camps.sort((a: any, b: any) => Number(b.active) - Number(a.active) || b.spend - a.spend),
    }
  }).sort((a, b) => b.d7.spend - a.d7.spend)
  return { sets: out, today, from }
}

export async function registerLaunch(row: any, by: string) {
  await ensureTrackingTables()
  await getPool().query(
    `INSERT INTO ads_launch (campaign_id, campaign_name, product_code, mkt_name, account_id, page_id, mode, videos, post_ids, start_at, rule_id, exclusions, seeding, reason, launched_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)
     ON CONFLICT (campaign_id) DO UPDATE SET mode=EXCLUDED.mode, reason=EXCLUDED.reason, seeding=EXCLUDED.seeding, post_ids=EXCLUDED.post_ids`,
    [row.campaign_id, row.campaign_name, row.product_code, row.mkt_name, row.account_id, row.page_id, row.mode, row.videos || [], row.post_ids || [],
     row.start_at || null, row.rule_id || null, JSON.stringify(row.exclusions || null), JSON.stringify(row.seeding || null), row.reason || null, by]
  )
}
