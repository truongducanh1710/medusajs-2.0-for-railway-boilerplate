import { Pool } from "pg"
import { publishPost, isTokenError } from "./fb-graph"
import { getPageTokens } from "../api/admin/fb-content/_lib"

/**
 * Auto post: each configured page gets 1 video post per VN day.
 * - fb_auto_post_rule: page → product_codes[] (1 code = single product, >1 = rotate daily) + post_time "HH:MM" VN.
 * - fb_auto_post_log: UNIQUE(page_id, day) is the claim — prevents double posting when
 *   several processes run the job. Failed days are retried up to MAX_ATTEMPTS.
 * Video: mkt_video of that product (status done/posted, has link), never/least recently posted on this page.
 * Caption: a caption already published for that product, least recently used on this page.
 */

export const AUTO_POST_USER = "auto-post"
const MAX_ATTEMPTS = 3
const CAPTION_LOOKBACK_DAYS = 120

/**
 * Caption must mention the product — some fb_scheduled_post rows link a caption to the wrong
 * product's video (verified 14/11: a kệ gia vị caption on a nồi chiên video). Postgres ~* regex.
 */
const CAPTION_KEYWORDS: Record<string, string> = {
  PHVVN026_CV: "chảo",
  PHVVN042_KGV: "gia vị|kệ",
  PHVVN020_TDH: "hạt|gạo|mọt|hộp",
  PHVVN036_NC: "chiên",
}

let _ready = false
export async function ensureAutoPostTables(pool: Pool): Promise<void> {
  if (_ready) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_auto_post_rule (
      page_id       VARCHAR(32) PRIMARY KEY,
      page_name     VARCHAR(255),
      product_codes TEXT[] NOT NULL,
      post_time     VARCHAR(5) NOT NULL DEFAULT '11:00',
      enabled       BOOLEAN NOT NULL DEFAULT true,
      rot_idx       INT NOT NULL DEFAULT 0,
      updated_by    VARCHAR(255),
      updated_at    TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_auto_post_log (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      page_id           VARCHAR(32) NOT NULL,
      page_name         VARCHAR(255),
      day               DATE NOT NULL,
      product_code      VARCHAR(64),
      video_id          UUID,
      vd_code           VARCHAR(16),
      scheduled_post_id UUID,
      post_id           VARCHAR(64),
      status            VARCHAR(20) NOT NULL DEFAULT 'running',
      attempts          INT NOT NULL DEFAULT 1,
      error             TEXT,
      created_at        TIMESTAMPTZ DEFAULT now(),
      updated_at        TIMESTAMPTZ DEFAULT now(),
      UNIQUE (page_id, day)
    )
  `)
  _ready = true
}

/** Current VN date "YYYY-MM-DD" and minutes since VN midnight. */
function vnNow(now = new Date()) {
  const vn = new Date(now.getTime() + 7 * 3600_000)
  return { day: vn.toISOString().slice(0, 10), minutes: vn.getUTCHours() * 60 + vn.getUTCMinutes() }
}

function timeToMinutes(t: string): number {
  const [h, m] = String(t || "11:00").split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

export type AutoPostPlan = {
  page_id: string
  page_name: string
  product_code: string | null
  video: { id: string; vd_code: string; link: string; status: string; last_here: string | null } | null
  caption: string | null
  reason?: string
}

async function pickVideo(pool: Pool, pageId: string, productCode: string) {
  const { rows } = await pool.query(
    `SELECT v.id, v.vd_code, v.link, v.status,
            (SELECT max(COALESCE(p.published_at, p.created_at)) FROM fb_scheduled_post p
              WHERE p.video_id = v.id AND p.page_id = $1 AND p.status IN ('published','scheduled')) AS last_here,
            (SELECT count(*) FROM fb_scheduled_post p WHERE p.video_id = v.id AND p.status = 'published')::int AS n_all
       FROM mkt_video v
      WHERE v.product_code = $2
        AND v.status IN ('done','posted')
        AND v.link ILIKE 'http%'
      ORDER BY last_here ASC NULLS FIRST, n_all ASC, v.created_at DESC
      LIMIT 1`,
    [pageId, productCode]
  )
  return rows[0] || null
}

async function pickCaption(pool: Pool, pageId: string, productCode: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT p.message,
            max(p.published_at) FILTER (WHERE p.page_id = $1) AS last_here,
            count(*) FILTER (WHERE p.published_at > now() - interval '3 days') AS recent_any
       FROM fb_scheduled_post p
       JOIN mkt_video v ON v.id = p.video_id
      WHERE v.product_code = $2
        AND p.status = 'published'
        AND length(p.message) > 40
        AND p.published_at > now() - ($3 || ' days')::interval
        AND p.message ~* $4
      GROUP BY p.message
      ORDER BY last_here ASC NULLS FIRST, recent_any ASC, random()
      LIMIT 1`,
    [pageId, productCode, String(CAPTION_LOOKBACK_DAYS), CAPTION_KEYWORDS[productCode] || "."]
  )
  return rows[0]?.message ?? null
}

/** Pick product (rotation-aware), video and caption for one rule. Skips products with no usable video. */
async function planRule(pool: Pool, rule: any): Promise<AutoPostPlan & { rot_used: number }> {
  const codes: string[] = rule.product_codes || []
  const base: AutoPostPlan = { page_id: rule.page_id, page_name: rule.page_name, product_code: null, video: null, caption: null }
  for (let k = 0; k < codes.length; k++) {
    const idx = (rule.rot_idx + k) % codes.length
    const code = codes[idx]
    const video = await pickVideo(pool, rule.page_id, code)
    if (!video) continue
    const caption = await pickCaption(pool, rule.page_id, code)
    if (!caption) continue
    return { ...base, product_code: code, video, caption, rot_used: idx }
  }
  return { ...base, reason: "Không có video hoặc caption dùng được cho sản phẩm nào", rot_used: rule.rot_idx }
}

/** Preview what each enabled rule would post now — no writes. */
export async function previewAutoPost(pool: Pool): Promise<AutoPostPlan[]> {
  await ensureAutoPostTables(pool)
  const { rows: rules } = await pool.query(`SELECT * FROM fb_auto_post_rule WHERE enabled ORDER BY post_time`)
  const out: AutoPostPlan[] = []
  for (const r of rules) {
    const { rot_used, ...plan } = await planRule(pool, r)
    out.push(plan)
  }
  return out
}

type Notify = (title: string, description: string) => Promise<void>

/** Called by the cron job. Posts for every enabled rule whose post_time has passed today (VN). */
export async function runAutoPost(pool: Pool, notify?: Notify): Promise<{ posted: number; failed: number }> {
  await ensureAutoPostTables(pool)
  const { day, minutes } = vnNow()
  const { rows: rules } = await pool.query(`SELECT * FROM fb_auto_post_rule WHERE enabled ORDER BY post_time`)
  let posted = 0, failed = 0
  let tokens: Awaited<ReturnType<typeof getPageTokens>> | null = null

  for (const rule of rules) {
    if (minutes < timeToMinutes(rule.post_time)) continue

    // Claim the (page, day) slot. Retry allowed only for failed attempts under the cap.
    const { rows: claim } = await pool.query(
      `INSERT INTO fb_auto_post_log (page_id, page_name, day, status)
       VALUES ($1, $2, $3, 'running')
       ON CONFLICT (page_id, day) DO UPDATE
         SET status = 'running', attempts = fb_auto_post_log.attempts + 1, error = NULL, updated_at = now()
         WHERE fb_auto_post_log.status = 'failed' AND fb_auto_post_log.attempts < $4
       RETURNING id`,
      [rule.page_id, rule.page_name, day, MAX_ATTEMPTS]
    )
    if (!claim.length) continue
    const logId = claim[0].id

    const fail = async (msg: string, extra: Record<string, any> = {}) => {
      failed++
      await pool.query(
        `UPDATE fb_auto_post_log SET status='failed', error=$2, product_code=COALESCE($3, product_code),
                video_id=COALESCE($4, video_id), vd_code=COALESCE($5, vd_code), updated_at=now() WHERE id=$1`,
        [logId, msg.slice(0, 500), extra.product_code ?? null, extra.video_id ?? null, extra.vd_code ?? null]
      )
      await notify?.(`❌ Tự đăng bài lỗi · ${rule.page_name}`, msg.slice(0, 200))
    }

    try {
      const plan = await planRule(pool, rule)
      if (!plan.video || !plan.caption || !plan.product_code) { await fail(plan.reason || "Không chọn được video"); continue }
      const meta = { product_code: plan.product_code, video_id: plan.video.id, vd_code: plan.video.vd_code }

      if (!tokens) tokens = await getPageTokens(pool)
      const page = tokens.find((t) => t.page_id === rule.page_id)
      if (!page) { await fail("Không có token page (page đã bị gỡ khỏi hệ thống?)", meta); continue }

      let postId: string
      try {
        const r = await publishPost({
          pageId: page.page_id, pageToken: page.access_token,
          message: plan.caption, driveUrl: plan.video.link, mediaType: "video",
        })
        postId = r.post_id
      } catch (e: any) {
        await fail(isTokenError(e) ? "Token page hết hạn" : (e?.message || "Lỗi đăng FB"), meta)
        continue
      }

      const { rows: [sp] } = await pool.query(
        `INSERT INTO fb_scheduled_post (page_id, page_name, post_id, message, drive_url, media_type, video_id, published_at, status, created_by, tags)
         VALUES ($1,$2,$3,$4,$5,'video',$6,now(),'published',$7,$8) RETURNING id`,
        [page.page_id, page.page_name, postId, plan.caption, plan.video.link, plan.video.id, AUTO_POST_USER, ["auto"]]
      )

      // Mark video posted + append link (same shape as manual posting)
      const { rows: [cur] } = await pool.query(`SELECT fb_post_links FROM mkt_video WHERE id = $1`, [plan.video.id])
      const links: any[] = Array.isArray(cur?.fb_post_links) ? cur.fb_post_links : []
      const url = `https://www.facebook.com/${postId}`
      if (!links.some((l) => l.post_url === url)) {
        links.push({ page_id: page.page_id, page_name: page.page_name, post_url: url, posted_at: new Date().toISOString() })
      }
      await pool.query(
        `UPDATE mkt_video SET status='posted', fb_post_links=$2, updated_at=now() WHERE id=$1`,
        [plan.video.id, JSON.stringify(links)]
      )

      await pool.query(
        `UPDATE fb_auto_post_log SET status='published', product_code=$2, video_id=$3, vd_code=$4,
                scheduled_post_id=$5, post_id=$6, error=NULL, updated_at=now() WHERE id=$1`,
        [logId, plan.product_code, plan.video.id, plan.video.vd_code, sp.id, postId]
      )
      // Advance rotation past the product just used
      const n = (rule.product_codes || []).length || 1
      await pool.query(`UPDATE fb_auto_post_rule SET rot_idx=$2 WHERE page_id=$1`, [rule.page_id, (plan.rot_used + 1) % n])
      posted++
    } catch (e: any) {
      await fail(e?.message || "Lỗi không xác định")
    }
  }
  return { posted, failed }
}
