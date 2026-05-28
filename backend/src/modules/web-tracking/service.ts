import { MedusaService } from "@medusajs/framework/utils"
import { Pool } from "pg"
import { randomUUID } from "crypto"
import WebSession from "./models/web-session"
import WebPageview from "./models/web-pageview"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

function parseDevice(ua: string): string {
  if (!ua) return "unknown"
  if (/mobile|android|iphone|ipod/i.test(ua)) return "mobile"
  if (/tablet|ipad/i.test(ua)) return "tablet"
  return "desktop"
}

export default class WebTrackingService extends MedusaService({ WebSession, WebPageview }) {
  async recordPageview(data: {
    visitor_id: string
    session_id: string
    url: string
    title?: string
    referrer?: string
    utm_source?: string
    utm_medium?: string
    utm_campaign?: string
    utm_content?: string
    utm_term?: string
    time_on_prev_page?: number
    has_cart?: boolean
    cart_id?: string
    ip?: string
    user_agent?: string
  }) {
    const pool = getPool()
    const now = new Date()
    const device = parseDevice(data.user_agent ?? "")
    const sessionId = `${data.visitor_id}_${data.session_id}`

    // Upsert session
    await pool.query(`
      INSERT INTO web_session (
        id, visitor_id, session_id, first_seen, last_seen,
        current_url, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        device_type, user_agent, ip, has_cart, cart_id, pageview_count,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$4,
        $5,$6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,1,
        $4,$4
      )
      ON CONFLICT (visitor_id, session_id) WHERE deleted_at IS NULL
      DO UPDATE SET
        last_seen = $4,
        current_url = $5,
        has_cart = GREATEST(web_session.has_cart::int, $15::int)::boolean,
        cart_id = COALESCE($16, web_session.cart_id),
        pageview_count = web_session.pageview_count + 1,
        updated_at = $4
    `, [
      sessionId,
      data.visitor_id,
      data.session_id,
      now,
      data.url ?? "",
      data.referrer ?? "",
      data.utm_source ?? "",
      data.utm_medium ?? "",
      data.utm_campaign ?? "",
      data.utm_content ?? "",
      data.utm_term ?? "",
      device,
      data.user_agent ?? "",
      data.ip ?? "",
      data.has_cart ?? false,
      data.cart_id ?? null,
    ])

    // Insert pageview
    await pool.query(`
      INSERT INTO web_pageview (id, visitor_id, session_id, url, title, referrer, utm_source, utm_campaign, time_on_prev_page, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
    `, [
      randomUUID(),
      data.visitor_id,
      data.session_id,
      data.url ?? "",
      data.title ?? "",
      data.referrer ?? "",
      data.utm_source ?? "",
      data.utm_campaign ?? "",
      data.time_on_prev_page ?? 0,
      now,
    ])
  }

  async getStats(windowMinutes = 5) {
    const pool = getPool()
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE last_seen >= NOW() - ($1 || ' minutes')::interval) AS active_visitors,
        COUNT(*) AS total_sessions_today,
        COUNT(*) FILTER (WHERE has_cart = true AND last_seen >= NOW() - ($1 || ' minutes')::interval) AS active_with_cart
      FROM web_session
      WHERE deleted_at IS NULL
        AND first_seen >= CURRENT_DATE AT TIME ZONE 'Asia/Ho_Chi_Minh'
    `, [windowMinutes])
    return result.rows[0]
  }

  async getSessions(opts: { active?: boolean; limit?: number; from?: string; to?: string }) {
    const pool = getPool()
    const conditions: string[] = ["s.deleted_at IS NULL"]
    const params: any[] = []
    let pi = 1

    if (opts.active) {
      conditions.push(`s.last_seen >= NOW() - interval '10 minutes'`)
    }
    if (opts.from) {
      conditions.push(`s.first_seen >= $${pi++}::date AT TIME ZONE 'Asia/Ho_Chi_Minh'`)
      params.push(opts.from)
    }
    if (opts.to) {
      conditions.push(`s.first_seen < ($${pi++}::date + interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh'`)
      params.push(opts.to)
    }

    const limit = opts.limit ?? 100
    params.push(limit)
    const where = conditions.join(" AND ")

    const result = await pool.query(`
      SELECT
        s.id, s.visitor_id, s.session_id,
        s.first_seen, s.last_seen, s.current_url,
        s.referrer, s.utm_source, s.utm_medium, s.utm_campaign,
        s.device_type, s.province, s.ip,
        s.has_cart, s.cart_id, s.pageview_count,
        -- last pageview url
        (SELECT url FROM web_pageview p WHERE p.visitor_id = s.visitor_id AND p.session_id = s.session_id AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 1) AS last_url
      FROM web_session s
      WHERE ${where}
      ORDER BY s.last_seen DESC
      LIMIT $${pi}
    `, params)
    return result.rows
  }

  async getVisitorHistory(visitorId: string, limit = 200) {
    const pool = getPool()
    const result = await pool.query(`
      SELECT id, session_id, url, title, referrer, utm_source, utm_campaign, time_on_prev_page, created_at
      FROM web_pageview
      WHERE visitor_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2
    `, [visitorId, limit])
    return result.rows
  }

  async getTopPages(opts: { windowMinutes?: number; limit?: number; from?: string; to?: string }) {
    const pool = getPool()
    const params: any[] = []
    let condition = "deleted_at IS NULL"
    let pi = 1

    if (opts.from && opts.to) {
      condition += ` AND created_at >= $${pi++}::date AT TIME ZONE 'Asia/Ho_Chi_Minh' AND created_at < ($${pi++}::date + interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh'`
      params.push(opts.from, opts.to)
    } else {
      const win = opts.windowMinutes ?? 60
      condition += ` AND created_at >= NOW() - ($${pi++} || ' minutes')::interval`
      params.push(win)
    }
    params.push(opts.limit ?? 20)

    const result = await pool.query(`
      SELECT url, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
      FROM web_pageview
      WHERE ${condition}
      GROUP BY url
      ORDER BY views DESC
      LIMIT $${pi}
    `, params)
    return result.rows
  }

  async getTopSources(opts: { windowMinutes?: number; limit?: number; from?: string; to?: string }) {
    const pool = getPool()
    const params: any[] = []
    let condition = "deleted_at IS NULL AND utm_source != ''"
    let pi = 1

    if (opts.from && opts.to) {
      condition += ` AND created_at >= $${pi++}::date AT TIME ZONE 'Asia/Ho_Chi_Minh' AND created_at < ($${pi++}::date + interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh'`
      params.push(opts.from, opts.to)
    } else {
      const win = opts.windowMinutes ?? 60
      condition += ` AND created_at >= NOW() - ($${pi++} || ' minutes')::interval`
      params.push(win)
    }
    params.push(opts.limit ?? 20)

    const result = await pool.query(`
      SELECT utm_source, utm_campaign, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
      FROM web_pageview
      WHERE ${condition}
      GROUP BY utm_source, utm_campaign
      ORDER BY views DESC
      LIMIT $${pi}
    `, params)
    return result.rows
  }
}
