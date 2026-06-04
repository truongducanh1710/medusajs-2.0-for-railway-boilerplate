import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"
import { fetchAllPageTokens } from "../../../lib/fb-graph"

let _pool: Pool | null = null
export function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

let _tablesReady = false
export async function ensureTables(pool: Pool): Promise<void> {
  if (_tablesReady) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_page_token (
      page_id      VARCHAR(32) PRIMARY KEY,
      page_name    VARCHAR(255) NOT NULL,
      access_token TEXT NOT NULL,
      category     VARCHAR(128),
      fan_count    INT DEFAULT 0,
      fetched_at   TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_scheduled_post (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      page_id       VARCHAR(32) NOT NULL,
      page_name     VARCHAR(255),
      post_id       VARCHAR(64),
      message       TEXT NOT NULL,
      drive_url     TEXT,
      media_type    VARCHAR(16) DEFAULT 'text',
      video_id      UUID,
      scheduled_for TIMESTAMPTZ,
      published_at  TIMESTAMPTZ,
      status        VARCHAR(20) DEFAULT 'pending',
      error_msg     TEXT,
      created_by    VARCHAR(255) NOT NULL,
      template_id   UUID,
      tags          TEXT[],
      created_at    TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_post_status ON fb_scheduled_post (status, scheduled_for)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_post_page   ON fb_scheduled_post (page_id, created_at DESC)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_post_user   ON fb_scheduled_post (created_by, created_at DESC)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_content_template (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title       VARCHAR(255) NOT NULL,
      message     TEXT NOT NULL,
      tags        TEXT[],
      usage_count INT DEFAULT 0,
      created_by  VARCHAR(255) NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now(),
      deleted_at  TIMESTAMPTZ
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_template_tags ON fb_content_template USING GIN (tags)`)
  _tablesReady = true
}

export type AuthInfo = { email: string; isSuper: boolean; fbPageIds: string[] | null }

export async function getAuthInfo(req: MedusaRequest): Promise<AuthInfo | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
  const isSuper = !!(user.email && user.email === process.env.SUPER_ADMIN_EMAIL)
  const raw = (user.metadata as any)?.fb_page_ids
  const fbPageIds = isSuper ? null : (Array.isArray(raw) ? raw.map(String) : [])
  return { email: user.email || "", isSuper, fbPageIds }
}

const CACHE_TTL_HOURS = 24

/**
 * Lấy page tokens: đọc cache fb_page_token, nếu rỗng/stale (>24h) hoặc force thì
 * gọi /me/accounts refresh + upsert. Trả list (chưa lọc theo quyền).
 */
export async function getPageTokens(pool: Pool, force = false): Promise<Array<{ page_id: string; page_name: string; access_token: string; category: string | null; fan_count: number }>> {
  if (!force) {
    const { rows } = await pool.query(
      `SELECT page_id, page_name, access_token, category, fan_count
       FROM fb_page_token WHERE fetched_at > now() - interval '${CACHE_TTL_HOURS} hours'`
    )
    if (rows.length) return rows
  }
  // refresh từ FB
  const pages = await fetchAllPageTokens()
  for (const p of pages) {
    await pool.query(
      `INSERT INTO fb_page_token (page_id, page_name, access_token, category, fan_count, fetched_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (page_id) DO UPDATE SET
         page_name = EXCLUDED.page_name, access_token = EXCLUDED.access_token,
         category = EXCLUDED.category, fan_count = EXCLUDED.fan_count, fetched_at = now()`,
      [p.page_id, p.page_name, p.access_token, p.category, p.fan_count]
    )
  }
  return pages.map(p => ({ page_id: p.page_id, page_name: p.page_name, access_token: p.access_token, category: p.category, fan_count: p.fan_count }))
}

/** Lọc theo quyền marketer (fb_page_ids). isSuper → all. */
export function filterByPerm<T extends { page_id: string }>(pages: T[], auth: AuthInfo): T[] {
  if (auth.isSuper || auth.fbPageIds === null) return pages
  const allow = new Set(auth.fbPageIds)
  return pages.filter(p => allow.has(p.page_id))
}
