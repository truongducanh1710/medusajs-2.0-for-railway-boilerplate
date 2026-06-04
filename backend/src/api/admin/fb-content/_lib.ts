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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_publish_job (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      total       INT NOT NULL DEFAULT 0,
      done        INT NOT NULL DEFAULT 0,
      status      VARCHAR(20) DEFAULT 'running',
      progress    JSONB DEFAULT '[]',
      created_by  VARCHAR(255),
      created_at  TIMESTAMPTZ DEFAULT now(),
      finished_at TIMESTAMPTZ
    )
  `)
  // Boost columns — tạo camp/ad từ bài đăng
  await pool.query(`ALTER TABLE fb_scheduled_post ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(64)`)
  await pool.query(`ALTER TABLE fb_scheduled_post ADD COLUMN IF NOT EXISTS adset_id VARCHAR(64)`)
  await pool.query(`ALTER TABLE fb_scheduled_post ADD COLUMN IF NOT EXISTS ad_id VARCHAR(64)`)
  await pool.query(`ALTER TABLE fb_scheduled_post ADD COLUMN IF NOT EXISTS boost_status VARCHAR(20) DEFAULT 'none'`)
  _tablesReady = true
}

// ============================================================================
// FB Graph API helpers cho tính năng Lên Camp
// ============================================================================
const FB_GRAPH = "https://graph.facebook.com/v18.0"

/** System User Token (không hết hạn) → fallback FB_ACCESS_TOKEN. */
export function getSysToken(): string {
  return process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
}

/** Gọi FB Graph API. method GET/POST. body cho POST (form-encoded). */
export async function callFb(method: "GET" | "POST", path: string, body?: Record<string, any>): Promise<any> {
  const token = getSysToken()
  const url = `${FB_GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${token}`
  const opts: any = { method }
  if (method === "POST" && body) {
    const form = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v))
    }
    opts.body = form
  }
  const res = await fetch(url, opts)
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { throw new Error(`FB parse error: ${text.slice(0, 300)}`) }
  if (data?.error) throw new Error(`FB: ${data.error.message} (code ${data.error.code})`)
  return data
}

/** Lấy tất cả ad accounts (có name) — đọc paging. */
export async function getFbAdAccounts(): Promise<Array<{ id: string; name: string; account_status: number }>> {
  let url = `/me/adaccounts?fields=id,name,account_status&limit=50`
  const all: any[] = []
  while (url) {
    const d = await callFb("GET", url)
    all.push(...(d.data || []))
    url = d.paging?.next ? d.paging.next.replace(FB_GRAPH, "").replace(/&access_token=[^&]*/, "") : ""
  }
  return all
}

/** Custom audiences của 1 ad account. */
export async function getFbAudiences(accId: string): Promise<Array<{ id: string; name: string; subtype: string }>> {
  let url = `/${accId}/customaudiences?fields=id,name,subtype&limit=50`
  const all: any[] = []
  while (url) {
    const d = await callFb("GET", url)
    all.push(...(d.data || []))
    url = d.paging?.next ? d.paging.next.replace(FB_GRAPH, "").replace(/&access_token=[^&]*/, "") : ""
  }
  return all
}

/** Pixels của 1 ad account. */
export async function getFbPixels(accId: string): Promise<Array<{ id: string; name: string }>> {
  const d = await callFb("GET", `/${accId}/adspixels?fields=id,name&limit=50`)
  return d.data || []
}

/** Campaigns + adsets của 1 ad account (để chọn adset có sẵn — Mode A). */
export async function getFbCampaignsWithAdsets(accId: string): Promise<Array<{ id: string; name: string; status: string; adsets: Array<{ id: string; name: string; status: string }> }>> {
  const d = await callFb("GET", `/${accId}/campaigns?fields=id,name,status,adsets{id,name,status}&limit=30`)
  return (d.data || []).map((c: any) => ({
    id: c.id, name: c.name, status: c.status,
    adsets: (c.adsets?.data || []).map((a: any) => ({ id: a.id, name: a.name, status: a.status })),
  }))
}

export type AuthInfo = { email: string; isSuper: boolean; isAdmin: boolean; fbPageIds: string[] | null; mktCode: string | null }

export async function getAuthInfo(req: MedusaRequest): Promise<AuthInfo | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
  const isSuper = !!(user.email && user.email === process.env.SUPER_ADMIN_EMAIL)
  const perms: string[] = Array.isArray((user.metadata as any)?.permissions) ? (user.metadata as any).permissions : []
  const isAdmin = isSuper || perms.includes("users.manage")
  const raw = (user.metadata as any)?.fb_page_ids
  const fbPageIds = isAdmin ? null : (Array.isArray(raw) ? raw.map(String) : [])
  const mktCode = (user.metadata as any)?.mkt_code ?? null
  return { email: user.email || "", isSuper, isAdmin, fbPageIds, mktCode }
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

/** Lọc theo quyền marketer (fb_page_ids). isAdmin/isSuper → all. */
export function filterByPerm<T extends { page_id: string }>(pages: T[], auth: AuthInfo): T[] {
  if (auth.isAdmin || auth.fbPageIds === null) return pages
  const allow = new Set(auth.fbPageIds)
  return pages.filter(p => allow.has(p.page_id))
}
