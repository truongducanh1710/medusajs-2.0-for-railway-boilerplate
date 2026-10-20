/**
 * Seeding post quảng cáo mới (user yêu cầu 19/10/2026): PAGE tự bình luận theo mẫu của sản phẩm — link mua,
 * tính năng kèm ảnh, cam kết, quà tặng. Bình luận link đăng trước. Chỉ bình luận dưới tên page.
 *
 * Mẫu = BỘ (ads_seeding_set) theo mã SP + (tuỳ chọn) đoạn link landing; các bình luận ở ads_seeding_template.
 * CHỈ seed bằng bộ ĐÃ DUYỆT khớp đúng SP (+ landing nếu bộ có đặt) — không có thì không seed, để không bao giờ
 * seed nhầm thông tin sang sản phẩm / ưu đãi khác (user 20/10/2026). AI soạn/sửa = nháp; người duyệt mới dùng.
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
      CREATE TABLE IF NOT EXISTS ads_seeding_set (
        set_key TEXT PRIMARY KEY,       -- vd PHVVN026CV hoặc PHVVN026CV@maybao
        product_code TEXT NOT NULL,
        ten TEXT NOT NULL,
        landing_match TEXT,             -- NULL = mọi landing của SP; có giá trị = link phải chứa đoạn này
        status TEXT NOT NULL DEFAULT 'draft',   -- draft | approved
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE ads_seeding_template ADD COLUMN IF NOT EXISTS set_key TEXT;
      UPDATE ads_seeding_template SET set_key = product_code WHERE set_key IS NULL;
      -- Bộ có sẵn từ trước (chảo vàng, user chỉ định mẫu 19/10, xác nhận dùng chung mọi landing 20/10) → đã duyệt
      INSERT INTO ads_seeding_set (set_key, product_code, ten, status, approved_by, approved_at, updated_by)
        SELECT DISTINCT product_code, product_code, product_code || ' — mẫu chung', 'approved', 'user (chat 20/10/2026)', now(), 'migration'
          FROM ads_seeding_template WHERE set_key = product_code
        ON CONFLICT (set_key) DO NOTHING;
    `).then(() => undefined).catch((e) => { ready = null; throw e })
  }
  return ready
}

export async function getSetItems(setKey: string) {
  await ensureSeedingTables()
  const { rows } = await getPool().query(`SELECT * FROM ads_seeding_template WHERE set_key=$1 ORDER BY sort`, [setKey])
  return rows
}

/** Bộ đã duyệt dùng cho SP + link: ưu tiên bộ có landing_match khớp link, rồi tới bộ chung của SP. */
export async function findApprovedSet(productCode: string, link: string) {
  await ensureSeedingTables()
  const { rows } = await getPool().query(`SELECT * FROM ads_seeding_set WHERE product_code=$1 AND status='approved'`, [productCode])
  const hit = rows.find((r: any) => r.landing_match && String(link || "").includes(r.landing_match)) || rows.find((r: any) => !r.landing_match)
  if (!hit) return null
  return { set: hit, items: await getSetItems(hit.set_key) }
}

export async function listSets() {
  await ensureSeedingTables()
  const { rows: sets } = await getPool().query(`SELECT * FROM ads_seeding_set ORDER BY product_code, set_key`)
  const { rows: items } = await getPool().query(`SELECT * FROM ads_seeding_template ORDER BY set_key, sort`)
  return sets.map((s: any) => ({ ...s, items: items.filter((i: any) => i.set_key === s.set_key) }))
}

/** AI soạn / sửa bộ → luôn về NHÁP (chờ người duyệt). */
export async function saveSet(o: { set_key?: string; product_code: string; ten: string; landing_match?: string | null; items: { sort: number; message: string; image_url?: string | null }[] }, by: string) {
  await ensureSeedingTables()
  const pool = getPool()
  const key = o.set_key || (o.landing_match ? `${o.product_code}@${o.landing_match}` : o.product_code)
  const before = { set: (await pool.query(`SELECT * FROM ads_seeding_set WHERE set_key=$1`, [key])).rows[0] || null, items: await getSetItems(key) }
  await pool.query(
    `INSERT INTO ads_seeding_set (set_key, product_code, ten, landing_match, status, updated_by, updated_at) VALUES ($1,$2,$3,$4,'draft',$5,now())
     ON CONFLICT (set_key) DO UPDATE SET product_code=EXCLUDED.product_code, ten=EXCLUDED.ten, landing_match=EXCLUDED.landing_match,
       status='draft', approved_by=NULL, approved_at=NULL, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [key, o.product_code, o.ten, o.landing_match || null, by]
  )
  await pool.query(`DELETE FROM ads_seeding_template WHERE set_key=$1`, [key])
  for (const it of o.items) {
    await pool.query(`INSERT INTO ads_seeding_template (product_code, set_key, sort, message, image_url, updated_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [o.product_code, key, Number(it.sort), String(it.message), it.image_url || null, by])
  }
  return { key, before, after: { set: (await pool.query(`SELECT * FROM ads_seeding_set WHERE set_key=$1`, [key])).rows[0], items: await getSetItems(key) } }
}

export async function approveSet(setKey: string, by: string) {
  await ensureSeedingTables()
  const { rows } = await getPool().query(
    `UPDATE ads_seeding_set SET status='approved', approved_by=$2, approved_at=now() WHERE set_key=$1 RETURNING *`, [setKey, by]
  )
  return rows[0] || null
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
  const found = await findApprovedSet(opts.product_code, opts.link)
  const tpl = found?.items || []
  const log = async (status: string, ids: any[], error?: string) => {
    await pool.query(`INSERT INTO ads_seeding_log (post_id, page_id, product_code, comment_ids, status, error, created_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
      [opts.post_id, pageId, opts.product_code, JSON.stringify(ids), status, error || null, opts.by])
    return { post_id: opts.post_id, status, comment_ids: ids, error }
  }
  if (!tpl.length) return log("no_template", [], `Chưa có mẫu seeding ĐÃ DUYỆT cho ${opts.product_code} (landing ${opts.link || "?"}) — không seed`)
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
