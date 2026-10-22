/**
 * Tệp loại trừ cho camp mới (user chốt 19/10/2026):
 *  1) "Đã đăng ký 180 ngày" theo pixel của sản phẩm — mỗi (tài khoản, pixel) 1 tệp WEBSITE; có sẵn tệp tương đương
 *     (cùng pixel, CompleteRegistration, 180 ngày) thì dùng lại, chưa có thì tạo.
 *  2) "Chặn POS" bản mới: khách bị chặn trên Pancake + khách hoàn hàng 180 ngày (SĐT mã hoá SHA-256),
 *     thay TOÀN BỘ danh sách MỖI NGÀY (21/10: khách bị chặn 20/10 vẫn lọt camp vì tệp làm theo tháng).
 *     Tệp cũ "khach_bi_chan_pos_19/6/26_800" chỉ được BỔ SUNG (thêm người), không thay/xoá.
 * Danh sách id tệp theo tài khoản nằm ở bảng ads_exclusion_audience — công cụ lên camp đọc bảng này.
 */
import crypto from "node:crypto"
import { getPool } from "./db"
import { callFbApi, FB_API_BASE } from "../api/admin/pancake-sync/report/camp-control/_lib"

/** Tài khoản + pixel sản phẩm cần tệp "đăng ký 180 ngày" (theo output/ads-autopilot/care/products.json). */
export const EXCLUSION_TARGETS: { account: string; label: string; pixels: string[] }[] = [
  { account: "act_1397084955139677", label: "ADS344", pixels: ["943650651603498"] },
  { account: "act_741222868885235", label: "ADS342", pixels: ["943650651603498", "648566867843285", "1487834185630970"] },
  { account: "act_899712815703406", label: "ADS329", pixels: ["943650651603498", "648566867843285"] },
  { account: "act_1133464788237858", label: "ADS327", pixels: ["1921074788473811", "648566867843285", "943650651603498"] },
  { account: "act_27214643188160995", label: "ADS348", pixels: ["648566867843285", "943650651603498"] }, // 23/10: thêm cho ANHTD
  { account: "act_1108526648426194", label: "ADS349", pixels: ["943650651603498"] }, // 20/10: camp BROAD chảo vàng Anh TD
]
const BLOCK_NAME = "PHV_CHAN_POS_AUTO (chặn POS + hoàn hàng 180d, cập nhật hằng ngày)"
/**
 * Tệp chặn CŨ "khach_bi_chan_pos_19/6/26_800" (camp cũ + camp các MKT khác đang gắn): user 21/10/2026 cho BỔ SUNG song song
 * (chỉ thêm người, không xoá/thay) — thêm người vào tệp không làm camp học lại.
 * 6985565582828 = bản ở ADS344; 120252094873620558 = bản gốc ADS329 (chia sẻ cho ADS342/327).
 */
const OLD_BLOCK_AUDIENCES = ["6985565582828", "120252094873620558"]
const D180 = 180 * 86400

let ready: Promise<void> | null = null
export function ensureExclusionTable() {
  if (!ready) {
    ready = getPool().query(`
      CREATE TABLE IF NOT EXISTS ads_exclusion_audience (
        account_id TEXT NOT NULL,
        kind TEXT NOT NULL,            -- pixel_cr180 | chan_pos
        pixel_id TEXT NOT NULL DEFAULT '',
        audience_id TEXT NOT NULL,
        name TEXT,
        created_by_us BOOLEAN NOT NULL DEFAULT false,
        user_count INT,
        last_sync_at TIMESTAMPTZ,
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, kind, pixel_id)
      )`).then(() => undefined).catch((e) => { ready = null; throw e })
  }
  return ready
}

/** POST form-body (danh sách SĐT băm quá dài cho query string như callFbApi). */
async function fbPost(path: string, body: Record<string, any>): Promise<{ ok: boolean; data: any }> {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) q.set(k, typeof v === "string" ? v : JSON.stringify(v))
  q.set("access_token", process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || "")
  try {
    const res = await fetch(`${FB_API_BASE}${path}`, { method: "POST", body: q })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok && !data?.error, data }
  } catch (e: any) {
    return { ok: false, data: { error: { message: e.message } } }
  }
}

async function upsertRow(account: string, kind: string, pixel: string, audienceId: string, name: string, ours: boolean, extra: { user_count?: number | null; last_error?: string | null; synced?: boolean } = {}) {
  await getPool().query(
    `INSERT INTO ads_exclusion_audience (account_id, kind, pixel_id, audience_id, name, created_by_us, user_count, last_sync_at, last_error, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,${extra.synced ? "now()" : "NULL"},$8,now())
     ON CONFLICT (account_id, kind, pixel_id) DO UPDATE SET audience_id=EXCLUDED.audience_id, name=EXCLUDED.name,
       user_count=COALESCE(EXCLUDED.user_count, ads_exclusion_audience.user_count),
       last_sync_at=COALESCE(EXCLUDED.last_sync_at, ads_exclusion_audience.last_sync_at),
       last_error=EXCLUDED.last_error, updated_at=now()`,
    [account, kind, pixel, audienceId, name, ours, extra.user_count ?? null, extra.last_error ?? null]
  )
}

/** Tệp WEBSITE đã có trên tài khoản: cùng pixel + CompleteRegistration + giữ 180 ngày. */
function isCr180(a: any, pixel: string) {
  const rule = typeof a.rule === "string" ? a.rule : JSON.stringify(a.rule || "")
  // chỉ đúng 1 pixel (tệp gộp nhiều pixel loại trừ rộng hơn sản phẩm)
  const pixels = new Set((rule.match(/"id"\s*:\s*"?(\d{12,})/g) || []).map((m) => m.replace(/\D/g, "")))
  return a.subtype === "WEBSITE" && Number(a.retention_days) === 180 && pixels.size === 1 && pixels.has(pixel)
    && /CompleteRegistration/i.test(rule) && !/exclusions/.test(rule)
}

export async function ensurePixelAudiences() {
  await ensureExclusionTable()
  const out: any[] = []
  for (const t of EXCLUSION_TARGETS) {
    // Danh sách gọn (không kèm rule — tài khoản nhiều tệp như ADS329 hỏi kèm rule bị FB từ chối
    // "reduce the amount of data"), rồi chỉ đọc rule của tệp WEBSITE giữ 180 ngày.
    const all: any[] = []
    let path: string | null = `/${t.account}/customaudiences?fields=id,name,subtype,retention_days&limit=50`
    let err: string | null = null
    while (path) {
      const page = await callFbApi("GET", path)
      if (!page.ok) { err = page.data?.error?.message; break }
      all.push(...(page.data.data || []))
      const after = page.data.paging?.cursors?.after
      path = page.data.paging?.next && after ? `/${t.account}/customaudiences?fields=id,name,subtype,retention_days&limit=50&after=${after}` : null
    }
    if (err) { out.push({ account: t.label, error: err }); continue }
    for (const a of all) {
      if (a.subtype !== "WEBSITE" || Number(a.retention_days) !== 180) continue
      const d = await callFbApi("GET", `/${a.id}?fields=rule`)
      if (d.ok) a.rule = d.data.rule
    }
    for (const px of t.pixels) {
      const found = all.find((a: any) => isCr180(a, px))
      if (found) {
        await upsertRow(t.account, "pixel_cr180", px, found.id, found.name, false)
        out.push({ account: t.label, pixel: px, audience_id: found.id, name: found.name, reused: true })
        continue
      }
      const name = `PHV_EXC_DangKy180d_PX${px}`
      const r = await fbPost(`/${t.account}/customaudiences`, {
        name, prefill: true,
        rule: { inclusions: { operator: "or", rules: [{ event_sources: [{ id: px, type: "pixel" }], retention_seconds: D180,
          filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "CompleteRegistration" }] } }] } },
      })
      if (!r.ok) { out.push({ account: t.label, pixel: px, error: r.data?.error?.error_user_msg || r.data?.error?.message }); continue }
      await upsertRow(t.account, "pixel_cr180", px, r.data.id, name, true)
      out.push({ account: t.label, pixel: px, audience_id: r.data.id, name, created: true })
    }
  }
  return out
}

/** SĐT VN → 84xxxxxxxxx (định dạng Facebook yêu cầu trước khi băm). */
export function normPhone(raw: string | null | undefined) {
  let d = String(raw || "").replace(/\D/g, "")
  if (!d) return null
  if (d.startsWith("0")) d = "84" + d.slice(1)
  else if (!d.startsWith("84")) d = "84" + d
  return d.length >= 10 && d.length <= 12 ? d : null
}

export async function blockListPhones() {
  const { rows } = await getPool().query(`
    SELECT DISTINCT p FROM (
      SELECT raw->'shipping_address'->>'phone_number' p FROM pancake_order
       WHERE deleted_at IS NULL AND (raw->'customer'->>'is_block') = 'true'
      UNION ALL
      SELECT jsonb_array_elements_text(raw->'customer'->'phone_numbers') FROM pancake_order
       WHERE deleted_at IS NULL AND (raw->'customer'->>'is_block') = 'true' AND jsonb_typeof(raw->'customer'->'phone_numbers') = 'array'
      UNION ALL
      SELECT raw->'shipping_address'->>'phone_number' FROM pancake_order
       WHERE deleted_at IS NULL AND status = 5 AND pancake_created_at > now() - interval '180 days'
    ) x`)
  const set = new Set<string>()
  for (const r of rows) { const n = normPhone(r.p); if (n) set.add(n) }
  return [...set]
}

/** Thay toàn bộ danh sách tệp chặn POS trên mọi tài khoản (tạo tệp mới nếu chưa có). */
export async function syncBlockList() {
  await ensureExclusionTable()
  const phones = await blockListPhones()
  const hashes = phones.map((p) => crypto.createHash("sha256").update(p).digest("hex"))
  const pool = getPool()
  const out: any[] = []
  for (const t of EXCLUSION_TARGETS) {
    let { rows } = await pool.query(`SELECT audience_id FROM ads_exclusion_audience WHERE account_id=$1 AND kind='chan_pos'`, [t.account])
    let audienceId = rows[0]?.audience_id as string | undefined
    if (!audienceId) {
      const r = await fbPost(`/${t.account}/customaudiences`, { name: BLOCK_NAME, subtype: "CUSTOM", customer_file_source: "USER_PROVIDED_ONLY",
        description: "Tự động: khách bị chặn trên Pancake POS + khách hoàn hàng 180 ngày. Không sửa tay." })
      if (!r.ok) { out.push({ account: t.label, error: r.data?.error?.error_user_msg || r.data?.error?.message }); continue }
      audienceId = r.data.id as string
      await upsertRow(t.account, "chan_pos", "", audienceId, BLOCK_NAME, true)
      // tệp mới: nạp lần đầu bằng /users (usersreplace cần tệp đã có người)
      const first = await uploadUsers(audienceId, hashes, false)
      await upsertRow(t.account, "chan_pos", "", audienceId, BLOCK_NAME, true, { user_count: first.ok ? hashes.length : null, last_error: first.error ?? null, synced: first.ok })
      out.push({ account: t.label, audience_id: audienceId, created: true, phones: hashes.length, ...first })
      continue
    }
    const r = await uploadUsers(audienceId, hashes, true)
    await upsertRow(t.account, "chan_pos", "", audienceId, BLOCK_NAME, true, { user_count: r.ok ? hashes.length : null, last_error: r.error ?? null, synced: r.ok })
    out.push({ account: t.label, audience_id: audienceId, phones: hashes.length, ...r })
  }
  // Bổ sung song song vào tệp chặn cũ (chỉ thêm, không thay)
  const old: any[] = []
  for (const id of OLD_BLOCK_AUDIENCES) old.push({ audience_id: id, ...(await uploadUsers(id, hashes, false)) })
  return { phones: hashes.length, accounts: out, old_lists: old }
}

async function uploadUsers(audienceId: string, hashes: string[], replace: boolean): Promise<{ ok: boolean; error?: string }> {
  const BATCH = 10000
  const sessionId = Number(String(Date.now()).slice(-9))
  const batches = Math.max(1, Math.ceil(hashes.length / BATCH))
  for (let i = 0; i < batches; i++) {
    const data = hashes.slice(i * BATCH, (i + 1) * BATCH).map((h) => [h])
    const body: any = { payload: { schema: ["PHONE"], data } }
    if (replace || batches > 1) body.session = { session_id: sessionId, batch_seq: i + 1, last_batch_flag: i === batches - 1, estimated_num_total: hashes.length }
    const r = await fbPost(`/${audienceId}/${replace ? "usersreplace" : "users"}`, body)
    if (!r.ok) return { ok: false, error: r.data?.error?.error_user_msg || r.data?.error?.message || "lỗi FB" }
  }
  return { ok: true }
}

export async function listExclusions() {
  await ensureExclusionTable()
  const { rows } = await getPool().query(`SELECT * FROM ads_exclusion_audience ORDER BY account_id, kind, pixel_id`)
  return rows
}
