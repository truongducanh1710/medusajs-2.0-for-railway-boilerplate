import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, getPageTokens, ensureTables } from "../_lib"

const FB_V = "v25.0"

async function fetchJson(url: string) {
  const r = await fetch(url)
  return r.json()
}

async function syncPageStats(pool: any, pageId: string, pageToken: string, pageName: string) {
  // Pull posts từ page feed
  const feedUrl = `https://graph.facebook.com/${FB_V}/${pageId}/feed?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares,attachments&limit=50&access_token=${pageToken}`
  const feed = await fetchJson(feedUrl)
  const posts: any[] = feed.data ?? []

  // Lấy post_id từ fb_scheduled_post để join product_code
  const postIds = posts.map((p: any) => p.id).filter(Boolean)
  let productMap: Record<string, { product_code: string; product_name: string; created_by: string }> = {}
  if (postIds.length > 0) {
    const placeholders = postIds.map((_: any, i: number) => `$${i + 1}`).join(",")
    const { rows: dbPosts } = await pool.query(
      `SELECT p.post_id, v.product_code, mp.name AS product_name, p.created_by
         FROM fb_scheduled_post p
         LEFT JOIN mkt_video v ON v.id = p.video_id
         LEFT JOIN mkt_product mp ON UPPER(mp.code) = UPPER(v.product_code)
        WHERE p.post_id = ANY(ARRAY[${placeholders}])`,
      postIds
    )
    for (const r of dbPosts) {
      productMap[r.post_id] = { product_code: r.product_code, product_name: r.product_name, created_by: r.created_by }
    }
  }

  let synced = 0
  for (const post of posts) {
    const postId = post.id
    if (!postId) continue

    const likes = post.likes?.summary?.total_count ?? 0
    const comments = post.comments?.summary?.total_count ?? 0
    const shares = post.shares?.count ?? 0
    const publishedAt = post.created_time ? new Date(post.created_time).toISOString() : null
    const mediaType = post.attachments?.data?.[0]?.type?.includes("video") ? "video" : "text"
    const meta = productMap[postId] ?? {}

    // Lấy reach từ Page Insights
    let reach = 0
    try {
      const insightUrl = `https://graph.facebook.com/${FB_V}/${postId}/insights?metric=post_impressions_unique&access_token=${pageToken}`
      const insight = await fetchJson(insightUrl)
      reach = insight.data?.[0]?.values?.[0]?.value ?? 0
    } catch {}

    // Video views nếu là video
    let videoViews = 0
    if (mediaType === "video") {
      try {
        const vUrl = `https://graph.facebook.com/${FB_V}/${postId}?fields=video_views&access_token=${pageToken}`
        const vd = await fetchJson(vUrl)
        videoViews = vd.video_views ?? 0
      } catch {}
    }

    await pool.query(`
      INSERT INTO fb_post_stats (post_id, page_id, page_name, message, media_type, product_code, product_name, created_by, published_at, likes, comments, shares, reach, video_views, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
      ON CONFLICT (post_id) DO UPDATE SET
        likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
        reach=EXCLUDED.reach, video_views=EXCLUDED.video_views, synced_at=now(),
        product_code=COALESCE(EXCLUDED.product_code, fb_post_stats.product_code),
        product_name=COALESCE(EXCLUDED.product_name, fb_post_stats.product_name),
        created_by=COALESCE(EXCLUDED.created_by, fb_post_stats.created_by)
    `, [postId, pageId, pageName, post.message ?? "", mediaType,
        meta.product_code ?? null, meta.product_name ?? null, meta.created_by ?? null,
        publishedAt, likes, comments, shares, reach, videoViews])
    synced++
  }
  return synced
}

/** GET /admin/fb-content/post-stats */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await ensureTables(pool)
    const q = req.query as Record<string, string>

    const params: any[] = []
    let where = "WHERE 1=1"
    if (q.page_id)      { params.push(q.page_id);      where += ` AND page_id = $${params.length}` }
    if (q.product_code) { params.push(q.product_code); where += ` AND UPPER(product_code) = UPPER($${params.length})` }
    if (q.from) { params.push(q.from); where += ` AND published_at >= $${params.length}` }
    if (q.to)   { params.push(q.to);   where += ` AND published_at <= $${params.length}` }

    const allowed = ["likes","comments","shares","reach","published_at"]
    const sort = allowed.includes(q.sort) ? q.sort : "published_at"
    const limit  = Math.min(parseInt(q.limit  || "50"),  200)
    const offset = parseInt(q.offset || "0")

    const { rows } = await pool.query(
      `SELECT * FROM fb_post_stats ${where} ORDER BY ${sort} DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, limit, offset]
    )
    const { rows: countRows } = await pool.query(`SELECT COUNT(*) AS total FROM fb_post_stats ${where}`, params)
    const { rows: sumRows } = await pool.query(
      `SELECT SUM(likes) AS total_likes, SUM(comments) AS total_comments, SUM(shares) AS total_shares, SUM(reach) AS total_reach, MAX(synced_at) AS last_synced FROM fb_post_stats ${where}`,
      params
    )

    return res.json({ posts: rows, total: parseInt(countRows[0].total), summary: sumRows[0] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/** POST /admin/fb-content/post-stats — trigger sync thủ công */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await ensureTables(pool)
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const b = (req.body as any) ?? {}
    const targetPageId = b.page_id ?? null

    const pages = await getPageTokens(pool, false)
    const toSync = targetPageId ? pages.filter((p: any) => p.page_id === targetPageId) : pages

    let totalSynced = 0
    for (const page of toSync) {
      try {
        const n = await syncPageStats(pool, page.page_id, page.access_token, page.page_name)
        totalSynced += n
      } catch (e: any) {
        console.error(`[fb-post-stats] sync error page ${page.page_id}:`, e.message)
      }
    }

    return res.json({ ok: true, synced: totalSynced, pages: toSync.length })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
