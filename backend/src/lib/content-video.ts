import { getPool } from "./db"
import { logAiUsage } from "./ai-usage"
import { extractMkt } from "./mkt-code"
import { MKT_ORDER_FILTER_SQL, ORDER_REVENUE_SQL } from "./mkt-today"
import { loadProducts, resolveProduct } from "./ad-content"
import { callFbApi, FB_API_BASE } from "../api/admin/pancake-sync/report/camp-control/_lib"

/**
 * Hiệu quả theo video cho tab /app/content-ads (mục "Theo video").
 * - ad_video_map: ad → video/bài/page (đọc creative 1 lần, ad không đổi video).
 * - content_video: thông tin video + chỉ số bài (xem 3s = trường post_views, khớp cột "xem tối thiểu 3 giây" trong trình tạo tệp),
 *   làm mới 12h/lần cho video có chi 14 ngày gần đây; lời thoại lấy theo yêu cầu bằng Gemini.
 * Chi phí lấy từ mkt_ads_cost_ad (có từ 20/7/2026). Đơn + doanh số theo mkt-today.ts, gắn theo p_utm_campaign = campaign_id,
 * camp có nhiều video thì chia theo tỷ lệ chi của từng ad trong camp-ngày.
 */

const FB_CONCURRENCY = 6
const STATS_MAX_AGE_H = 12
const STATS_ACTIVE_DAYS = 14
const MAX_VIDEOS_PER_RUN = 400
const GEMINI_KEY = process.env.GEMINI_API_KEY || ""
const TRANSCRIPT_MODEL = "gemini-3.5-flash"
const TRANSCRIPT_PROMPT = `Xem toàn bộ video quảng cáo này từ đầu đến cuối.
Nhiệm vụ DUY NHẤT: chép chính xác lời thoại/voiceover tiếng Việt, đúng thứ tự.
- Không phân tích, không nhận xét.
- Nếu có chữ lớn trên màn hình mà không đọc thành lời, ghi riêng ở cuối dưới dòng "CHỮ TRÊN MÀN HÌNH:".
- Video không có lời thoại thì ghi "(không có lời thoại)".
Trả về văn bản thuần, không JSON.`

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

let tablesReady = false
async function ensureTables() {
  if (tablesReady) return
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ad_video_map (
      ad_id TEXT PRIMARY KEY,
      video_id TEXT,                -- null: ad ảnh hoặc không đọc được
      post_id TEXT,                 -- effective_object_story_id dạng {page}_{post}
      page_id TEXT,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ad_video_map_video ON ad_video_map (video_id);
    CREATE TABLE IF NOT EXISTS content_video (
      video_id TEXT PRIMARY KEY,
      page_id TEXT,
      page_name TEXT,
      post_id TEXT,
      title TEXT,
      length_s INT,
      uploaded_at TIMESTAMPTZ,
      picture TEXT,
      permalink TEXT,
      views_3s BIGINT,
      plays BIGINT,
      avg_watch_s NUMERIC,
      reactions INT,
      comments INT,
      shares INT,
      stats_at TIMESTAMPTZ,
      transcript TEXT,
      transcript_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS content_video_sync (
      id INT PRIMARY KEY DEFAULT 1,
      synced_at TIMESTAMPTZ,
      ads_mapped INT,
      videos_refreshed INT,
      duration_ms INT,
      error TEXT
    );
  `)
  tablesReady = true
}

/** Token page (đọc chỉ số video/bài cần token page). */
async function pageTokens(): Promise<Map<string, { token: string; name: string }>> {
  const out = new Map<string, { token: string; name: string }>()
  let path = "/me/accounts?fields=id,name,access_token&limit=100"
  for (let i = 0; i < 10 && path; i++) {
    const r = await callFbApi("GET", path)
    if (!r.ok) break
    for (const p of r.data.data || []) out.set(String(p.id), { token: p.access_token, name: p.name })
    const after = r.data.paging?.next ? r.data.paging?.cursors?.after : null
    path = after ? `/me/accounts?fields=id,name,access_token&limit=100&after=${after}` : ""
  }
  return out
}

async function fbGet(path: string, token: string): Promise<any> {
  const r = await fetch(`${FB_API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${token}`, { signal: AbortSignal.timeout(30000) })
  const j = await r.json().catch(() => ({}))
  if (j?.error) throw new Error(String(j.error.message || "FB error").slice(0, 160))
  return j
}

/** Ad chưa biết video → đọc creative theo lô 50. */
async function mapNewAds(): Promise<number> {
  const pool = getPool()
  const { rows } = await pool.query(
    `SELECT DISTINCT c.ad_id FROM mkt_ads_cost_ad c LEFT JOIN ad_video_map m ON m.ad_id = c.ad_id
      WHERE c.deleted_at IS NULL AND c.spend > 0 AND c.ad_id IS NOT NULL AND m.ad_id IS NULL`
  )
  const ids: string[] = rows.map((r: any) => String(r.ad_id))
  const fields = "creative{video_id,effective_object_story_id,object_story_spec{page_id,video_data{video_id}}}"
  const read = (id: string, a: any) => {
    const c = a?.creative || {}
    const post: string | null = c.effective_object_story_id || null
    return { ad_id: id, video_id: c.video_id || c.object_story_spec?.video_data?.video_id || null, post_id: post, page_id: c.object_story_spec?.page_id || post?.split("_")[0] || null }
  }
  const found: any[] = []
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50))
  await mapLimit(batches, 3, async (batch) => {
    const r = await callFbApi("GET", `/?ids=${batch.join(",")}&fields=${encodeURIComponent(fields)}`)
    if (r.ok) {
      for (const id of batch) found.push(read(id, r.data[id]))
      return
    }
    // Cả lô lỗi khi có ad đã xoá: đọc lẻ, ad lỗi vẫn ghi (video null) để không đọc lại mãi
    for (const id of batch) {
      const one = await callFbApi("GET", `/${id}?fields=${encodeURIComponent(fields)}`)
      found.push(read(id, one.ok ? one.data : null))
    }
  })
  if (found.length) {
    await pool.query(
      `INSERT INTO ad_video_map (ad_id, video_id, post_id, page_id)
       SELECT x->>'ad_id', x->>'video_id', x->>'post_id', x->>'page_id' FROM jsonb_array_elements($1::jsonb) x
       ON CONFLICT (ad_id) DO NOTHING`,
      [JSON.stringify(found)]
    )
  }
  return found.length
}

/** Video mới, hoặc đang có chi và chỉ số đã cũ hơn 12h → đọc lại từ page. */
async function refreshVideoStats(): Promise<number> {
  const pool = getPool()
  const { rows } = await pool.query(
    `WITH v AS (
       SELECT m.video_id, (ARRAY_AGG(m.page_id ORDER BY m.checked_at DESC))[1] page_id, (ARRAY_AGG(m.post_id ORDER BY m.checked_at DESC))[1] post_id,
              MAX(c.date) last_spend, SUM(c.spend) spend
         FROM ad_video_map m JOIN mkt_ads_cost_ad c ON c.ad_id = m.ad_id AND c.deleted_at IS NULL AND c.spend > 0
        WHERE m.video_id IS NOT NULL GROUP BY m.video_id)
     SELECT v.* FROM v LEFT JOIN content_video cv ON cv.video_id = v.video_id
      WHERE cv.video_id IS NULL OR cv.stats_at IS NULL
         OR (v.last_spend >= CURRENT_DATE - $1::int AND cv.stats_at < now() - ($2::int * interval '1 hour'))
      ORDER BY v.spend DESC LIMIT $3`,
    [STATS_ACTIVE_DAYS, STATS_MAX_AGE_H, MAX_VIDEOS_PER_RUN]
  )
  if (!rows.length) return 0
  const tokens = await pageTokens()
  const anyToken = [...tokens.values()][0]?.token || process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
  let done = 0
  await mapLimit(rows, FB_CONCURRENCY, async (r: any) => {
    const page = tokens.get(String(r.page_id))
    const token = page?.token || anyToken
    const v: any = { video_id: r.video_id, page_id: r.page_id, page_name: page?.name || null, post_id: r.post_id }
    try {
      const j = await fbGet(`/${r.video_id}?fields=title,description,length,created_time,post_views,views,picture,permalink_url`, token)
      Object.assign(v, {
        title: String(j.title || j.description || "").replace(/\s+/g, " ").trim().slice(0, 500) || null,
        length_s: j.length ? Math.round(j.length) : null,
        uploaded_at: j.created_time || null,
        picture: j.picture || null,
        permalink: j.permalink_url ? (String(j.permalink_url).startsWith("http") ? j.permalink_url : `https://www.facebook.com${j.permalink_url}`) : null,
        views_3s: j.post_views ?? null,
        plays: j.views ?? null,
      })
    } catch {
      // Video của page không có token (page ngoài BM): vẫn ghi để không đọc lại mỗi lượt
    }
    try {
      const ins = await fbGet(`/${r.video_id}/video_insights?metric=post_video_avg_time_watched,total_video_avg_time_watched&period=lifetime`, token)
      for (const m of ins.data || []) {
        const val = m.values?.[0]?.value
        if (typeof val === "number" && val > 0) v.avg_watch_s = Math.round(val / 100) / 10
      }
    } catch {}
    if (r.post_id) {
      try {
        const p = await fbGet(`/${r.post_id}?fields=reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares`, token)
        Object.assign(v, { reactions: p.reactions?.summary?.total_count ?? null, comments: p.comments?.summary?.total_count ?? null, shares: p.shares?.count ?? 0 })
      } catch {}
    }
    await pool.query(
      `INSERT INTO content_video (video_id, page_id, page_name, post_id, title, length_s, uploaded_at, picture, permalink, views_3s, plays, avg_watch_s, reactions, comments, shares, stats_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       ON CONFLICT (video_id) DO UPDATE SET page_id = EXCLUDED.page_id, page_name = COALESCE(EXCLUDED.page_name, content_video.page_name),
         post_id = EXCLUDED.post_id, title = COALESCE(EXCLUDED.title, content_video.title), length_s = COALESCE(EXCLUDED.length_s, content_video.length_s),
         uploaded_at = COALESCE(EXCLUDED.uploaded_at, content_video.uploaded_at), picture = COALESCE(EXCLUDED.picture, content_video.picture),
         permalink = COALESCE(EXCLUDED.permalink, content_video.permalink), views_3s = COALESCE(EXCLUDED.views_3s, content_video.views_3s),
         plays = COALESCE(EXCLUDED.plays, content_video.plays), avg_watch_s = COALESCE(EXCLUDED.avg_watch_s, content_video.avg_watch_s),
         reactions = COALESCE(EXCLUDED.reactions, content_video.reactions), comments = COALESCE(EXCLUDED.comments, content_video.comments),
         shares = COALESCE(EXCLUDED.shares, content_video.shares), stats_at = now()`,
      [v.video_id, v.page_id, v.page_name, v.post_id, v.title ?? null, v.length_s ?? null, v.uploaded_at ?? null, v.picture ?? null, v.permalink ?? null,
        v.views_3s ?? null, v.plays ?? null, v.avg_watch_s ?? null, v.reactions ?? null, v.comments ?? null, v.shares ?? null]
    )
    done++
  })
  return done
}

export type VideoSyncResult = { synced_at: string; ads_mapped: number; videos_refreshed: number }

async function doSync(): Promise<VideoSyncResult> {
  await ensureTables()
  const started = Date.now()
  let ads = 0, vids = 0, error: string | null = null
  try {
    ads = await mapNewAds()
    vids = await refreshVideoStats()
  } catch (e: any) {
    error = String(e.message || e).slice(0, 300)
  }
  const synced_at = new Date().toISOString()
  await getPool().query(
    `INSERT INTO content_video_sync (id, synced_at, ads_mapped, videos_refreshed, duration_ms, error) VALUES (1, $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET synced_at = EXCLUDED.synced_at, ads_mapped = EXCLUDED.ads_mapped, videos_refreshed = EXCLUDED.videos_refreshed,
       duration_ms = EXCLUDED.duration_ms, error = EXCLUDED.error`,
    [synced_at, ads, vids, Date.now() - started, error]
  )
  if (error) throw new Error(error)
  return { synced_at, ads_mapped: ads, videos_refreshed: vids }
}

let running: Promise<VideoSyncResult> | null = null
export function syncContentVideos(): Promise<VideoSyncResult> {
  if (!running) running = doSync().finally(() => { running = null })
  return running
}

const todayVN = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const isDate = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Gom chi + đơn theo video trong khoảng ngày (theo giờ VN). Lần đầu chưa đồng bộ thì chạy nền và trả syncing. */
export async function readContentVideos(fromIn?: string, toIn?: string) {
  await ensureTables()
  const pool = getPool()
  const to = isDate(toIn) ? toIn! : todayVN()
  const from = isDate(fromIn) ? fromIn! : "2026-07-20"
  const sync = (await pool.query(`SELECT * FROM content_video_sync WHERE id = 1`)).rows[0] || null
  if (!sync && !running) syncContentVideos().catch((e) => console.error("[content-video] first sync", e.message))

  const { rows: cost } = await pool.query(
    `SELECT c.date::date::text d, c.campaign_id c, c.campaign_name cn, c.ad_id a, c.mkt_name m, c.ad_account_id acc,
            c.spend::bigint s, c.impressions::bigint i, c.clicks::bigint k, m.video_id v, m.post_id p, m.page_id pg
       FROM mkt_ads_cost_ad c LEFT JOIN ad_video_map m ON m.ad_id = c.ad_id
      WHERE c.deleted_at IS NULL AND c.spend > 0 AND c.date::date BETWEEN $1::date AND $2::date`,
    [from, to]
  )
  const { rows: ord } = await pool.query(
    `SELECT (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text d, raw->>'p_utm_campaign' c,
            count(*)::int o, count(*) FILTER (WHERE status = 3)::int g, SUM(${ORDER_REVENUE_SQL})::bigint ds
       FROM pancake_order
      WHERE ${MKT_ORDER_FILTER_SQL} AND status NOT IN (-2, 7) AND raw->>'p_utm_campaign' IS NOT NULL
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      GROUP BY 1, 2`,
    [from, to]
  )
  const campDay = new Map<string, number>()
  for (const r of cost) campDay.set(`${r.d}|${r.c}`, (campDay.get(`${r.d}|${r.c}`) || 0) + Number(r.s))
  const O = new Map<string, any>(ord.map((o: any) => [`${o.d}|${o.c}`, o]))
  const recent7 = new Date(Date.parse(to) - 6 * 864e5).toISOString().slice(0, 10)
  const recent2 = new Date(Date.parse(todayVN()) - 1 * 864e5).toISOString().slice(0, 10)

  type Agg = { v: string; s: number; i: number; k: number; o: number; g: number; ds: number; s7: number; s_recent: number
    ads: Set<string>; mkts: Map<string, number>; camps: Map<string, number>; d0: string; d1: string; days: Set<string>; post: string | null; page: string | null; mkt0: string }
  const V = new Map<string, Agg>()
  let unmapped = 0
  for (const r of cost) {
    const s = Number(r.s)
    if (!r.v) { unmapped += s; continue }
    const o = O.get(`${r.d}|${r.c}`)
    const share = s / (campDay.get(`${r.d}|${r.c}`) || s || 1)
    let a = V.get(r.v)
    if (!a) {
      a = { v: r.v, s: 0, i: 0, k: 0, o: 0, g: 0, ds: 0, s7: 0, s_recent: 0, ads: new Set(), mkts: new Map(), camps: new Map(), d0: r.d, d1: r.d, days: new Set(), post: r.p, page: r.pg, mkt0: "" }
      V.set(r.v, a)
    }
    a.s += s; a.i += Number(r.i); a.k += Number(r.k)
    if (o) { a.o += o.o * share; a.g += o.g * share; a.ds += Number(o.ds) * share }
    if (r.d >= recent7) a.s7 += s
    if (r.d >= recent2) a.s_recent += s
    a.ads.add(r.a); a.days.add(r.d)
    const mkt = r.m || extractMkt(r.cn || "")
    a.mkts.set(mkt, (a.mkts.get(mkt) || 0) + s)
    a.camps.set(r.cn || "", (a.camps.get(r.cn || "") || 0) + s)
    if (r.d < a.d0) a.d0 = r.d
    if (r.d > a.d1) a.d1 = r.d
  }

  const ids = [...V.keys()]
  const { rows: meta } = await pool.query(
    `SELECT video_id, page_id, page_name, post_id, title, length_s, uploaded_at, picture, permalink, views_3s, plays, avg_watch_s,
            reactions, comments, shares, stats_at, transcript, transcript_at FROM content_video WHERE video_id = ANY($1::text[])`,
    [ids]
  )
  const M = new Map<string, any>(meta.map((m: any) => [m.video_id, m]))
  const products = await loadProducts()
  const top = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k)
  const rows = [...V.values()].map((a) => {
    const m = M.get(a.v) || {}
    const mkts = top(a.mkts)
    const camp = top(a.camps)[0] || ""
    const product = resolveProduct(camp, "", mkts[0] || "", products)
    const post: string | null = m.post_id || a.post
    return {
      video_id: a.v,
      post_id: post,
      post_short: post?.split("_")[1] || null,
      page_id: m.page_id || a.page,
      page_name: m.page_name || null,
      title: m.title || null,
      length_s: m.length_s ?? null,
      uploaded_at: m.uploaded_at || null,
      picture: m.picture || null,
      permalink: m.permalink || (post ? `https://www.facebook.com/${post}` : null),
      views_3s: m.views_3s === null || m.views_3s === undefined ? null : Number(m.views_3s),
      avg_watch_s: m.avg_watch_s === null || m.avg_watch_s === undefined ? null : Number(m.avg_watch_s),
      reactions: m.reactions ?? null,
      comments: m.comments ?? null,
      shares: m.shares ?? null,
      stats_at: m.stats_at || null,
      transcript: m.transcript || null,
      transcript_at: m.transcript_at || null,
      product_code: product.code,
      product_name: product.name,
      mkts,
      ads: a.ads.size,
      first_day: a.d0,
      last_day: a.d1,
      days: a.days.size,
      spend: a.s,
      spend_7d: a.s7,
      running: a.s_recent > 0,
      impressions: a.i,
      clicks: a.k,
      orders: Math.round(a.o * 10) / 10,
      delivered: Math.round(a.g * 10) / 10,
      revenue: Math.round(a.ds),
      pct: a.ds > 0 ? Math.round((a.s / a.ds) * 1000) / 10 : null,
      cost_per_order: a.o > 0 ? Math.round(a.s / a.o) : null,
      cpm: a.i > 0 ? Math.round((a.s / a.i) * 1000) : null,
      ctr: a.i > 0 ? Math.round((a.k / a.i) * 10000) / 100 : null,
    }
  }).sort((x, y) => y.spend - x.spend)

  return { from, to, synced_at: sync?.synced_at ?? null, syncing: running !== null, unmapped_spend: unmapped, rows }
}

/** Lời thoại video bằng Gemini: lấy file từ FB (token page) → Files API → generateContent. Lưu vào content_video. */
export async function transcribeVideo(videoId: string): Promise<string> {
  if (!GEMINI_KEY) throw new Error("Chưa cấu hình GEMINI_API_KEY")
  await ensureTables()
  const pool = getPool()
  const { rows } = await pool.query(
    `SELECT COALESCE(cv.page_id, m.page_id) page_id FROM ad_video_map m LEFT JOIN content_video cv ON cv.video_id = m.video_id
      WHERE m.video_id = $1 LIMIT 1`,
    [videoId]
  )
  const tokens = await pageTokens()
  const token = tokens.get(String(rows[0]?.page_id))?.token || [...tokens.values()][0]?.token
  if (!token) throw new Error("Không có token page để tải video")
  const src = (await fbGet(`/${videoId}?fields=source`, token)).source
  if (!src) throw new Error("Facebook không trả file video (có thể page không cấp quyền)")
  const buf = Buffer.from(await (await fetch(src, { signal: AbortSignal.timeout(120000) })).arrayBuffer())

  const G = "https://generativelanguage.googleapis.com"
  const start = await fetch(`${G}/upload/v1beta/files?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buf.length), "X-Goog-Upload-Header-Content-Type": "video/mp4",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: `fbvideo-${videoId}` } }),
  })
  const uploadUrl = start.headers.get("x-goog-upload-url")
  if (!uploadUrl) throw new Error("Gemini không trả link tải lên")
  const up = await (await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Length": String(buf.length) },
    body: buf,
  })).json()
  const file = up.file
  if (!file?.uri) throw new Error("Tải video lên Gemini lỗi")
  try {
    for (let i = 0; i < 30; i++) {
      const st = await (await fetch(`${G}/v1beta/${file.name}?key=${GEMINI_KEY}`)).json()
      if (st.state === "ACTIVE") break
      if (st.state === "FAILED") throw new Error("Gemini xử lý video lỗi")
      await new Promise((r) => setTimeout(r, 2000))
    }
    const res = await (await fetch(`${G}/v1beta/models/${TRANSCRIPT_MODEL}:generateContent?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ file_data: { mime_type: "video/mp4", file_uri: file.uri } }, { text: TRANSCRIPT_PROMPT }] }],
        generationConfig: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(180000),
    })).json()
    const text: string | undefined = res?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("").trim()
    if (!text) throw new Error(res?.error?.message || "Gemini không trả lời thoại")
    await logAiUsage({
      feature: "content_video_transcript", run_id: videoId, model: TRANSCRIPT_MODEL, provider: "gemini",
      usage: { prompt_tokens: res?.usageMetadata?.promptTokenCount ?? 0, completion_tokens: res?.usageMetadata?.candidatesTokenCount ?? 0 },
      context: { video_id: videoId },
    } as any).catch(() => {})
    await pool.query(
      `INSERT INTO content_video (video_id, transcript, transcript_at) VALUES ($1, $2, now())
       ON CONFLICT (video_id) DO UPDATE SET transcript = EXCLUDED.transcript, transcript_at = now()`,
      [videoId, text]
    )
    return text
  } finally {
    fetch(`${G}/v1beta/${file.name}?key=${GEMINI_KEY}`, { method: "DELETE" }).catch(() => {})
  }
}
