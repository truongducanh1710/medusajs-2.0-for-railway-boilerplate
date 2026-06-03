import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, getPageTokens, filterByPerm } from "../_lib"
import { getPagePosts, isTokenError } from "../../../../lib/fb-graph"

const BATCH = 5
// cache in-memory 15 phút theo key (since-until-pages)
const cache = new Map<string, { at: number; data: any }>()
const TTL = 15 * 60 * 1000

/**
 * GET /admin/fb-content/insights?from=&to=&page_ids=
 * Viral tracker: fetch posts từ các page (batch), merge + sort theo điểm tương tác.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const q = req.query as Record<string, string>

    const until = q.to ? Math.floor(new Date(q.to).getTime() / 1000) : Math.floor(Date.now() / 1000)
    const since = q.from ? Math.floor(new Date(q.from).getTime() / 1000) : until - 7 * 86400

    const pool = getPool()
    let allPages: any[]
    try { allPages = await getPageTokens(pool) }
    catch (e: any) {
      if (isTokenError(e)) return res.status(200).json({ posts: [], kpis: null, error: "FB_TOKEN_EXPIRED" })
      throw e
    }
    let pages = filterByPerm(allPages, auth)
    if (q.page_ids) {
      const ids = new Set(q.page_ids.split(",").map(s => s.trim()))
      pages = pages.filter(p => ids.has(p.page_id))
    }
    pages = pages.slice(0, 25) // an toàn rate limit

    const cacheKey = `${since}-${until}-${pages.map(p => p.page_id).join(",")}`
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.at < TTL) return res.json(hit.data)

    const all: any[] = []
    for (let i = 0; i < pages.length; i += BATCH) {
      const slice = pages.slice(i, i + BATCH)
      const batches = await Promise.all(slice.map(async (page) => {
        try {
          const posts = await getPagePosts({ pageId: page.page_id, pageToken: page.access_token, since, until, limit: 25 })
          return posts.map(p => ({ ...p, page_name: page.page_name, page_id: page.page_id }))
        } catch { return [] }
      }))
      batches.forEach(b => all.push(...b))
    }

    // score = reactions + comments*2 + shares*3
    const scored = all.map(p => ({
      ...p,
      diem: p.reactions + p.comments * 2 + p.shares * 3,
    })).sort((a, b) => b.diem - a.diem).slice(0, 50)

    const kpis = {
      totalPosts: all.length,
      reactions: all.reduce((s, p) => s + p.reactions, 0),
      comments: all.reduce((s, p) => s + p.comments, 0),
      shares: all.reduce((s, p) => s + p.shares, 0),
    }
    const data = { posts: scored, kpis }
    cache.set(cacheKey, { at: Date.now(), data })
    return res.json(data)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
