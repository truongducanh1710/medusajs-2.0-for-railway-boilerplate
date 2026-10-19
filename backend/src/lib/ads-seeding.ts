/**
 * Seeding post quảng cáo mới (user yêu cầu 19/10/2026): PAGE tự bình luận theo mẫu của sản phẩm — link mua,
 * tính năng kèm ảnh, cam kết, quà tặng. Bình luận link đăng trước. Chỉ bình luận dưới tên page.
 * Mẫu theo mã SP (vd PHVVN026CV) ở ads_seeding_template; mỗi lần seed ghi ads_seeding_log.
 */
import { getPool } from "./db"
import { FB_API_BASE } from "../api/admin/pancake-sync/report/camp-control/_lib"

let ready: Promise<void> | null = null
export function ensureSeedingTables() {
  if (!ready) {
    ready = getPool().query(`
      CREATE TABLE IF NOT EXISTS ads_seeding_template (
        id BIGSERIAL PRIMARY KEY,
        product_code TEXT NOT NULL,
        sort INT NOT NULL,
        message TEXT NOT NULL,          -- {link} = landing của camp
        image_url TEXT,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ads_seeding_template_product_idx ON ads_seeding_template (product_code, sort);
      CREATE TABLE IF NOT EXISTS ads_seeding_log (
        id BIGSERIAL PRIMARY KEY,
        post_id TEXT NOT NULL,
        page_id TEXT,
        product_code TEXT,
        comment_ids JSONB,
        status TEXT NOT NULL,           -- done | partial | skipped | error
        error TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ads_seeding_log_post_idx ON ads_seeding_log (post_id);
    `).then(() => undefined).catch((e) => { ready = null; throw e })
  }
  return ready
}

export async function getTemplate(productCode: string) {
  await ensureSeedingTables()
  const { rows } = await getPool().query(`SELECT * FROM ads_seeding_template WHERE product_code=$1 ORDER BY sort`, [productCode])
  return rows
}

export async function replaceTemplate(productCode: string, items: { sort: number; message: string; image_url?: string | null }[], by: string) {
  await ensureSeedingTables()
  const pool = getPool()
  const before = await getTemplate(productCode)
  await pool.query(`DELETE FROM ads_seeding_template WHERE product_code=$1`, [productCode])
  for (const it of items) {
    await pool.query(`INSERT INTO ads_seeding_template (product_code, sort, message, image_url, updated_by) VALUES ($1,$2,$3,$4,$5)`,
      [productCode, Number(it.sort), String(it.message), it.image_url || null, by])
  }
  return { before, after: await getTemplate(productCode) }
}

async function pageToken(pageId: string): Promise<string | null> {
  const { rows } = await getPool().query(`SELECT access_token FROM fb_page_token WHERE page_id=$1`, [pageId])
  return rows[0]?.access_token || null
}

async function fb(method: "GET" | "POST", path: string, token: string, body?: Record<string, string>) {
  const q = new URLSearchParams({ ...(body || {}), access_token: token })
  const url = method === "GET" ? `${FB_API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${token}` : `${FB_API_BASE}${path}`
  const res = await fetch(url, method === "GET" ? undefined : { method: "POST", body: q })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && !data?.error, data }
}

/**
 * Seed 1 post: post_id dạng {page_id}_{story_id}. Bỏ qua nếu page đã có ≥ số bình luận của mẫu trên post
 * (đã seed rồi) — trừ khi force. Trả comment ids theo thứ tự mẫu.
 */
export async function seedPost(opts: { post_id: string; product_code: string; link: string; by: string; force?: boolean }) {
  await ensureSeedingTables()
  const pool = getPool()
  const pageId = opts.post_id.split("_")[0]
  const tpl = await getTemplate(opts.product_code)
  const log = async (status: string, ids: any[], error?: string) => {
    await pool.query(`INSERT INTO ads_seeding_log (post_id, page_id, product_code, comment_ids, status, error, created_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
      [opts.post_id, pageId, opts.product_code, JSON.stringify(ids), status, error || null, opts.by])
    return { post_id: opts.post_id, status, comment_ids: ids, error }
  }
  if (!tpl.length) return log("error", [], `Chưa có mẫu seeding cho ${opts.product_code}`)
  const token = await pageToken(pageId)
  if (!token) return log("error", [], `Không có token page ${pageId}`)
  if (!opts.force) {
    const cur = await fb("GET", `/${opts.post_id}/comments?fields=from{id}&filter=toplevel&limit=100`, token)
    if (!cur.ok) return log("error", [], `Không đọc được bình luận: ${cur.data?.error?.message}`)
    const mine = (cur.data.data || []).filter((c: any) => c.from?.id === pageId).length
    if (mine >= tpl.length) return log("skipped", [], `Post đã có ${mine} bình luận của page`)
  }
  const ids: any[] = []
  for (const t of tpl) {
    const body: Record<string, string> = { message: String(t.message).replace(/\{link\}/g, opts.link) }
    if (t.image_url) body.attachment_url = t.image_url
    const r = await fb("POST", `/${opts.post_id}/comments`, token, body)
    if (!r.ok) return log(ids.length ? "partial" : "error", ids, `Bình luận #${t.sort}: ${r.data?.error?.error_user_msg || r.data?.error?.message}`)
    ids.push(r.data.id)
    await new Promise((s) => setTimeout(s, 4000)) // giãn nhịp, giống người đăng tay
  }
  return log("done", ids)
}

export async function seedingLogs(limit = 50) {
  await ensureSeedingTables()
  const { rows } = await getPool().query(`SELECT * FROM ads_seeding_log ORDER BY created_at DESC LIMIT $1`, [limit])
  return rows
}
