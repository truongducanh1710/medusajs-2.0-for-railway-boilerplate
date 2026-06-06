import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, getPageTokens, ensureTables } from "../_lib"

const FB_V = "v25.0"

async function fetchJson(url: string) {
  const r = await fetch(url)
  return r.json()
}

async function syncOnePageStats(pool: any, pageId: string, pageToken: string, pageName: string) {
  // 1. Fan count mới nhất
  let fanCount = 0
  try {
    const pd = await fetchJson(`https://graph.facebook.com/${FB_V}/${pageId}?fields=fan_count&access_token=${pageToken}`)
    fanCount = pd.fan_count ?? 0
  } catch {}

  // 2. Page Insights (7 ngày)
  let reach7d = 0, engaged7d = 0, newFans7d = 0
  try {
    const insightUrl = `https://graph.facebook.com/${FB_V}/${pageId}/insights?metric=page_impressions_unique,page_engaged_users,page_fan_adds_unique&period=week&access_token=${pageToken}`
    const ins = await fetchJson(insightUrl)
    for (const m of (ins.data ?? [])) {
      const val = m.values?.[m.values.length - 1]?.value ?? 0
      if (m.name === "page_impressions_unique") reach7d = val
      if (m.name === "page_engaged_users")      engaged7d = val
      if (m.name === "page_fan_adds_unique")    newFans7d = val
    }
  } catch {}

  // 3. Tổng hợp từ fb_post_stats
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { rows: aggRows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE published_at >= $2) AS post_count_7d,
       COUNT(*)                                   AS total_posts,
       COALESCE(SUM(likes), 0)                    AS total_likes,
       COALESCE(SUM(reach), 0)                    AS total_reach
     FROM fb_post_stats WHERE page_id = $1`,
    [pageId, since7d]
  )
  const agg = aggRows[0] ?? {}

  await pool.query(`
    INSERT INTO fb_page_stats (page_id, page_name, fan_count, new_fans_7d, reach_7d, engaged_7d, post_count_7d, total_posts, total_likes, total_reach, synced_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
    ON CONFLICT (page_id) DO UPDATE SET
      page_name     = EXCLUDED.page_name,
      fan_count     = EXCLUDED.fan_count,
      new_fans_7d   = EXCLUDED.new_fans_7d,
      reach_7d      = EXCLUDED.reach_7d,
      engaged_7d    = EXCLUDED.engaged_7d,
      post_count_7d = EXCLUDED.post_count_7d,
      total_posts   = EXCLUDED.total_posts,
      total_likes   = EXCLUDED.total_likes,
      total_reach   = EXCLUDED.total_reach,
      synced_at     = now()
  `, [
    pageId, pageName, fanCount, newFans7d, reach7d, engaged7d,
    parseInt(agg.post_count_7d) || 0,
    parseInt(agg.total_posts)   || 0,
    parseInt(agg.total_likes)   || 0,
    parseInt(agg.total_reach)   || 0,
  ])
}

/** GET /admin/fb-content/page-stats */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await ensureTables(pool)
    const { rows } = await pool.query(
      `SELECT ps.*, pt.category, pt.access_token
       FROM fb_page_stats ps
       LEFT JOIN fb_page_token pt ON pt.page_id = ps.page_id
       ORDER BY ps.fan_count DESC`
    )
    const synced_at = rows[0]?.synced_at ?? null
    return res.json({ pages: rows, synced_at })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/** POST /admin/fb-content/page-stats — trigger sync thủ công */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await ensureTables(pool)
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const pages = await getPageTokens(pool, false)
    let synced = 0
    const errors: string[] = []

    for (const page of pages) {
      try {
        await syncOnePageStats(pool, page.page_id, page.access_token, page.page_name)
        synced++
      } catch (e: any) {
        errors.push(`${page.page_name}: ${e.message}`)
        console.error(`[page-stats] sync error ${page.page_id}:`, e.message)
      }
    }

    return res.json({ ok: true, synced, total: pages.length, errors })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
