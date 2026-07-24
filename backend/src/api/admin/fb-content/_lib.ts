import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"
import { fetchAllPageTokens } from "../../../lib/fb-graph"
import { resolveUserPerms } from "../../middlewares"

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
  await pool.query(`ALTER TABLE fb_scheduled_post ADD COLUMN IF NOT EXISTS post_id VARCHAR(64)`)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_fb_post_post_id ON fb_scheduled_post (post_id) WHERE post_id IS NOT NULL`)
  // fb_post_stats: lưu insights từ Facebook API (likes, comments, shares, reach)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_post_stats (
      post_id       VARCHAR(64) PRIMARY KEY,
      page_id       VARCHAR(32) NOT NULL,
      page_name     VARCHAR(255),
      message       TEXT,
      media_type    VARCHAR(16),
      thumbnail_url TEXT,
      product_code  VARCHAR(64),
      product_name  VARCHAR(255),
      created_by    VARCHAR(255),
      published_at  TIMESTAMPTZ,
      likes         INT DEFAULT 0,
      comments      INT DEFAULT 0,
      shares        INT DEFAULT 0,
      reach         INT DEFAULT 0,
      video_views   INT DEFAULT 0,
      synced_at     TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_stats_page ON fb_post_stats (page_id, published_at DESC)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_stats_product ON fb_post_stats (product_code)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_stats_likes ON fb_post_stats (likes DESC)`)
  await pool.query(`ALTER TABLE fb_post_stats ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`)
  // fb_page_stats: thống kê tổng thể từng Facebook Page
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_page_stats (
      page_id        VARCHAR(32) PRIMARY KEY,
      page_name      VARCHAR(255),
      fan_count      INT DEFAULT 0,
      new_fans_7d    INT DEFAULT 0,
      reach_7d       INT DEFAULT 0,
      engaged_7d     INT DEFAULT 0,
      post_count_7d  INT DEFAULT 0,
      total_posts    INT DEFAULT 0,
      total_likes    INT DEFAULT 0,
      total_reach    INT DEFAULT 0,
      synced_at      TIMESTAMPTZ DEFAULT now()
    )
  `)
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
  if (data?.error) throw new Error(`FB: ${data.error.message} (code ${data.error.code}) sub=${data.error.error_subcode} msg=${data.error.error_user_msg} path=${path.split("?")[0]}`)
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

/** Tạo Website Custom Audience từ pixel event (Purchase/AddToCart/ViewContent...).
 * Trả audience id. */
export async function createWebsiteAudience(accId: string, opts: {
  name: string; pixelId: string; event: string; retentionDays: number
}): Promise<string> {
  // rule chuẩn: ai fire event X trên pixel trong N ngày
  const rule = {
    inclusions: {
      operator: "or",
      rules: [{
        event_sources: [{ type: "pixel", id: opts.pixelId }],
        retention_seconds: opts.retentionDays * 86400,
        filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: opts.event }] },
      }],
    },
  }
  const d = await callFb("POST", `/${accId}/customaudiences`, {
    name: opts.name,
    subtype: "WEBSITE",
    retention_days: opts.retentionDays,
    rule: JSON.stringify(rule),
    prefill: true,
  })
  return d.id
}

/** Tạo Lookalike audience từ 1 source audience (vd tệp Purchase). */
export async function createLookalike(accId: string, opts: {
  name: string; sourceAudienceId: string; ratio: number; country?: string
}): Promise<string> {
  const spec = { country: opts.country || "VN", ratio: opts.ratio / 100 }
  const d = await callFb("POST", `/${accId}/customaudiences`, {
    name: opts.name,
    subtype: "LOOKALIKE",
    origin_audience_id: opts.sourceAudienceId,
    lookalike_spec: JSON.stringify(spec),
  })
  return d.id
}

/** Map camp → pixel: quét adsets của 1 account, lấy pixel_id + event + campaign.
 * Trả mỗi adset 1 dòng (1 camp có thể nhiều adset → group ở caller). */
export async function getAdsetsPixelMap(accId: string): Promise<Array<{
  adset_id: string; adset_name: string; campaign_id: string; campaign_name: string
  status: string; pixel_id: string | null; event_type: string | null
}>> {
  let url = `/${accId}/adsets?fields=id,name,effective_status,campaign{id,name},promoted_object{pixel_id,custom_event_type}&limit=100`
  const all: any[] = []
  let guard = 0
  while (url && guard++ < 20) {
    const d = await callFb("GET", url)
    for (const a of (d.data || [])) {
      const po = a.promoted_object || {}
      all.push({
        adset_id: a.id,
        adset_name: a.name,
        campaign_id: a.campaign?.id || "",
        campaign_name: a.campaign?.name || "",
        status: a.effective_status || "",
        pixel_id: po.pixel_id || null,
        event_type: po.custom_event_type || null,
      })
    }
    url = d.paging?.next ? d.paging.next.replace(FB_GRAPH, "").replace(/&access_token=[^&]*/, "") : ""
  }
  return all
}

/** Lấy thông tin 1 ad từ FB: creative, adset, campaign. */
export async function getFbAdInfo(adId: string): Promise<{
  ad_id: string; ad_name: string; page_id?: string
  creative: { id: string; object_story_id?: string; video_id?: string; image_hash?: string; name?: string; body?: string; object_story_spec?: { page_id?: string; video_data?: { call_to_action?: { value?: { link?: string } } } } }
  adset: { id: string; name: string; campaign_id: string; promoted_object?: { pixel_id?: string } }
  campaign: { id: string; name: string; objective: string }
}> {
  const d = await callFb("GET", `/${adId}?fields=id,name,creative{id,name,object_story_id,video_id,image_hash,body,object_story_spec},adset{id,name,campaign_id,promoted_object},campaign{id,name,objective}`)
  return {
    ad_id: d.id,
    ad_name: d.name,
    page_id: d.creative?.object_story_spec?.page_id,
    creative: d.creative || {},
    adset: d.adset || {},
    campaign: d.campaign || {},
  }
}

/** Tạo unpublished (dark) post trên page để dùng làm creative cho ads.
 * Trả object_story_id = page_id + "_" + post_id. */
export async function createUnpublishedPost(opts: {
  pageId: string; pageToken: string; message: string
  videoId?: string; imageUrl?: string; link?: string; name?: string; description?: string
}): Promise<{ post_id: string; object_story_id: string }> {
  const body: Record<string, any> = {
    message: opts.message,
    published: false,
  }
  if (opts.videoId) {
    // Video dark post — qua /{page-id}/videos
    const v = await fetch(`https://graph.facebook.com/v18.0/${opts.pageId}/videos`, {
      method: "POST",
      body: (() => {
        const f = new URLSearchParams()
        f.append("access_token", opts.pageToken)
        f.append("description", opts.message)
        f.append("video_id", opts.videoId)
        f.append("published", "false")
        return f
      })(),
    }).then(r => r.json()) as any
    if (v?.error) throw new Error(`FB dark video: ${v.error.message}`)
    return { post_id: v.id, object_story_id: `${opts.pageId}_${v.id}` }
  }
  if (opts.link) {
    body.link = opts.link
    if (opts.name) body.name = opts.name
    if (opts.description) body.description = opts.description
  }
  if (opts.imageUrl) body.url = opts.imageUrl
  const endpoint = opts.imageUrl ? `/${opts.pageId}/photos` : `/${opts.pageId}/feed`
  const r = await fetch(`https://graph.facebook.com/v18.0${endpoint}`, {
    method: "POST",
    body: (() => {
      const f = new URLSearchParams()
      f.append("access_token", opts.pageToken)
      for (const [k, v] of Object.entries(body)) f.append(k, String(v))
      return f
    })(),
  }).then(r => r.json()) as any
  if (r?.error) throw new Error(`FB dark post: ${r.error.message}`)
  const pid = r.post_id || r.id
  return { post_id: pid, object_story_id: `${opts.pageId}_${pid}` }
}

/** Chuyển Drive "view" URL thành direct-download URL. Trả null nếu không parse được. */
export function driveViewToDownloadUrl(viewUrl: string): string | null {
  const m = viewUrl.match(/\/file\/d\/([^/]+)/) || viewUrl.match(/[?&]id=([^&]+)/)
  if (!m) return null
  return `https://drive.google.com/uc?export=download&id=${m[1]}`
}

/**
 * Upload video từ Drive lên FB ad account qua /advideos (file_url).
 * Nếu file_url bị FB reject (Drive đôi khi chặn fetch trực tiếp), fallback
 * download file về buffer rồi upload qua multipart (source).
 * Trả về video_id (chưa chắc đã "ready", caller cần poll).
 */
export async function uploadVideoToFbFromDrive(adAccountId: string, driveViewUrl: string, name: string): Promise<string> {
  const downloadUrl = driveViewToDownloadUrl(driveViewUrl)
  if (!downloadUrl) throw new Error(`Không parse được Drive URL: ${driveViewUrl}`)
  const token = getSysToken()

  // Thử 1: để FB tự fetch qua file_url (nhanh, không tốn băng thông server)
  try {
    const form = new URLSearchParams()
    form.append("name", name)
    form.append("file_url", downloadUrl)
    form.append("access_token", token)
    const res = await fetch(`https://graph-video.facebook.com/v18.0/${adAccountId}/advideos`, { method: "POST", body: form })
    const data: any = await res.json()
    if (!data?.error && data?.id) return data.id
  } catch { /* fall through to resumable upload */ }

  // Thử 2: download về buffer rồi upload qua resumable upload (start/transfer/finish)
  const fileRes = await fetch(downloadUrl)
  if (!fileRes.ok) throw new Error(`Không tải được video từ Drive (status ${fileRes.status})`)
  const buf = Buffer.from(await fileRes.arrayBuffer())
  const fileSize = buf.length

  const startForm = new URLSearchParams()
  startForm.append("upload_phase", "start")
  startForm.append("file_size", String(fileSize))
  startForm.append("access_token", token)
  const start: any = await fetch(`https://graph-video.facebook.com/v18.0/${adAccountId}/advideos`, { method: "POST", body: startForm }).then(r => r.json())
  if (start?.error) throw new Error(`FB resumable start: ${start.error.message}`)
  const uploadSessionId = start.upload_session_id
  const videoId = start.video_id
  let startOffset = Number(start.start_offset)
  const endOffset = Number(start.end_offset)

  let offset = startOffset
  while (offset < fileSize) {
    const chunkEnd = Math.min(offset + (endOffset - startOffset || 4 * 1024 * 1024), fileSize)
    const chunk = buf.subarray(offset, chunkEnd)
    const transferForm = new FormData()
    transferForm.append("upload_phase", "transfer")
    transferForm.append("start_offset", String(offset))
    transferForm.append("upload_session_id", uploadSessionId)
    transferForm.append("access_token", token)
    transferForm.append("video_file_chunk", new Blob([chunk]))
    const t: any = await fetch(`https://graph-video.facebook.com/v18.0/${adAccountId}/advideos`, { method: "POST", body: transferForm as any }).then(r => r.json())
    if (t?.error) throw new Error(`FB resumable transfer: ${t.error.message}`)
    offset = Number(t.start_offset)
    if (Number.isNaN(offset) || offset === 0 && chunkEnd >= fileSize) offset = chunkEnd
  }

  const finishForm = new URLSearchParams()
  finishForm.append("upload_phase", "finish")
  finishForm.append("upload_session_id", uploadSessionId)
  finishForm.append("access_token", token)
  const finish: any = await fetch(`https://graph-video.facebook.com/v18.0/${adAccountId}/advideos`, { method: "POST", body: finishForm }).then(r => r.json())
  if (finish?.error) throw new Error(`FB resumable finish: ${finish.error.message}`)

  return videoId
}

/** Poll video_status đến khi ready (hoặc timeout). Trả thumbnail preferred nếu có. */
export async function waitForFbVideoReady(videoId: string, timeoutMs = 120_000): Promise<{ ready: boolean; thumbnailUrl: string | null }> {
  const token = getSysToken()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const d: any = await callFb("GET", `/${videoId}?fields=status`)
    const state = d?.status?.video_status
    if (state === "ready") {
      const thumbs: any = await fetch(`https://graph.facebook.com/v18.0/${videoId}/thumbnails?access_token=${token}`).then(r => r.json())
      const preferred = (thumbs?.data || []).find((t: any) => t.is_preferred) || thumbs?.data?.[0]
      return { ready: true, thumbnailUrl: preferred?.uri || null }
    }
    if (state === "error") throw new Error(`FB video xử lý lỗi: ${JSON.stringify(d.status)}`)
    await new Promise(r => setTimeout(r, 4000))
  }
  return { ready: false, thumbnailUrl: null }
}

export type AuthInfo = { email: string; isSuper: boolean; isAdmin: boolean; fbPageIds: string[] | null; mktCode: string | null }

export async function getAuthInfo(req: MedusaRequest): Promise<AuthInfo | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
  const isSuper = !!(user.email && user.email === process.env.SUPER_ADMIN_EMAIL)
  const perms = resolveUserPerms(user.metadata)
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
