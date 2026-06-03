import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"
import { fetchAllPageTokens } from "../../../lib/fb-graph"

let _pool: Pool | null = null
export function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
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
