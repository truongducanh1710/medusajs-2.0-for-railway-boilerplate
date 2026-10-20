/**
 * Quy trình bắt buộc cho MỌI camp mới của XUANLT / ANHTD (user yêu cầu 20/10/2026) — máy chủ tự kiểm 15 phút/lần,
 * kể cả camp người khác lên ngoài công cụ của AI. Mỗi bước lưu trạng thái ok | pending | error | skip + lý do:
 *   exclusions — adset loại trừ đủ tệp "đăng ký 180 ngày" theo pixel + tệp chặn POS mới của tài khoản (không tự sửa:
 *                đổi nhắm chọn camp đang chạy làm học lại → chỉ báo)
 *   setup      — tuổi tối thiểu ≥ 25, Advantage+ đối tượng, tối ưu đúng pixel trong products
 *   seeding    — mọi post của camp có đủ bình luận của page theo mẫu SP; thiếu thì TỰ seed (7h–22h, tối đa vài post/lượt)
 *   tu_scale   — camp đang bật đã gắn Tự scale; chưa thì TỰ gắn khi camp đã có chi tiêu (bộ theo MKT + SP);
 *                camp từng bị gỡ khỏi Tự scale (người/AI quyết) thì tôn trọng
 *   theo_doi   — có dòng ads_launch; camp lên ngoài công cụ thì tự ghi kiểu "ngoai_quy_trinh"
 * Lỗi mới → Telegram cho SUPER_ADMIN_EMAIL (1 lần/lỗi).
 */
import { getPool } from "./db"
import { FB_API_BASE } from "../api/admin/pancake-sync/report/camp-control/_lib"
import { ensureExclusionTable } from "./ads-exclusion"
import { ensureSeedingTables, getTemplate, seedPost } from "./ads-seeding"
import { ensureTrackingTables, registerLaunch } from "./ads-tracking"
import { notifyTelegramByEmail } from "./notify"

const MKTS = /_(XUANLT|ANHTD)_/
const LOOKBACK_DAYS = 3
const SEED_PER_RUN = 6

/** Bộ điều kiện Tự scale theo MKT + mã SP / loại camp (khớp products.json của công cụ lên camp). */
function ruleFor(name: string): number | null {
  if (/XAKHO/.test(name)) return 5
  if (/_XUANLT_/.test(name)) return 1
  if (/^PHVVN042KGV/.test(name)) return 2
  if (/^PHVVN038KLD/.test(name)) return /_MESS/.test(name) ? null : 4 // Messenger không đo được đơn qua utm
  if (/^PHVVN026CV/.test(name)) return 3
  return null
}

let ready: Promise<void> | null = null
export function ensureCheckTable() {
  if (!ready) {
    ready = getPool().query(`
      CREATE TABLE IF NOT EXISTS ads_launch_check (
        campaign_id TEXT PRIMARY KEY,
        campaign_name TEXT,
        account_id TEXT,
        mkt_name TEXT,
        created_time TIMESTAMPTZ,
        status TEXT NOT NULL,          -- ok | pending | error
        steps JSONB NOT NULL,
        notified JSONB,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`).then(() => undefined).catch((e) => { ready = null; throw e })
  }
  return ready
}

const token = () => process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
async function fbGet(path: string, tok = token()) {
  const r = await fetch(`${FB_API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${tok}`)
  const d: any = await r.json().catch(() => ({}))
  if (d?.error) throw new Error(d.error.message)
  return d
}

type Step = { status: "ok" | "pending" | "error" | "skip"; detail: string; at: string }
const step = (status: Step["status"], detail: string): Step => ({ status, detail, at: new Date().toISOString() })

async function accounts(): Promise<string[]> {
  const { rows } = await getPool().query(
    `SELECT DISTINCT ad_account_id a FROM auto_scale_camp WHERE ad_account_id IS NOT NULL
     UNION SELECT DISTINCT account_id FROM ads_exclusion_audience
     UNION SELECT DISTINCT ad_account_id FROM mkt_ads_cost WHERE mkt_name IN ('XUANLT','ANHTD') AND date >= current_date - 14 AND ad_account_id IS NOT NULL`
  )
  return [...new Set(rows.map((r: any) => String(r.a).startsWith("act_") ? r.a : `act_${r.a}`))]
}

export async function runLaunchChecks(userModule?: any, opts: { onlyCampaignId?: string } = {}) {
  await Promise.all([ensureCheckTable(), ensureExclusionTable(), ensureSeedingTables(), ensureTrackingTables()])
  const pool = getPool()
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86400
  const vnHour = new Date(Date.now() + 7 * 3600e3).getUTCHours()
  const seedWindow = vnHour >= 7 && vnHour < 22
  let seedBudget = SEED_PER_RUN
  const { rows: exc } = await pool.query(`SELECT * FROM ads_exclusion_audience`)
  const { rows: tokRows } = await pool.query(`SELECT page_id, access_token FROM fb_page_token`)
  const pageTok = new Map(tokRows.map((r: any) => [r.page_id, r.access_token]))
  const results: any[] = []

  for (const acc of await accounts()) {
    let camps: any[] = []
    try {
      const filtering = encodeURIComponent(JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "CAMPAIGN_PAUSED", "ADSET_PAUSED"] }]))
      camps = ((await fbGet(`/${acc}/campaigns?fields=id,name,status,effective_status,created_time&filtering=${filtering}&limit=300`)).data || [])
        .filter((x: any) => Date.parse(String(x.created_time).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) / 1000 > since)
    } catch (e: any) { results.push({ account: acc, error: e.message }); continue }
    for (const c of camps) {
      if (!MKTS.test(c.name) || ["ARCHIVED", "DELETED"].includes(c.status)) continue
      if (opts.onlyCampaignId && c.id !== opts.onlyCampaignId) continue
      results.push(await checkOne(c, acc, { exc, pageTok, seedWindow, take: () => seedBudget-- > 0, userModule }))
    }
  }
  return results
}

async function checkOne(c: any, acc: string, ctx: { exc: any[]; pageTok: Map<string, string>; seedWindow: boolean; take: () => boolean; userModule?: any }) {
  const pool = getPool()
  const mkt = (c.name.match(MKTS) || [])[1]
  const sku = (c.name.match(/^(PHVVN\w+?)_/) || [])[1] || null
  const steps: Record<string, Step> = {}
  let detail: any
  try {
    detail = await fbGet(`/${c.id}?fields=adsets{targeting,promoted_object,start_time},ads{name,effective_status,creative{effective_object_story_id,object_story_spec{video_data{call_to_action}}}}`)
  } catch (e: any) {
    steps.doc_camp = step("error", `Không đọc được camp: ${e.message}`)
    return save(c, acc, mkt, steps, ctx.userModule)
  }
  const adsets = detail.adsets?.data || []
  const pixel = adsets[0]?.promoted_object?.pixel_id || null

  // 1. Tệp loại trừ
  const needPx = ctx.exc.find((a) => a.account_id === acc && a.kind === "pixel_cr180" && a.pixel_id === pixel)
  const needBlk = ctx.exc.find((a) => a.account_id === acc && a.kind === "chan_pos")
  const missing: string[] = []
  for (const s of adsets) {
    const ids = new Set((s.targeting?.excluded_custom_audiences || []).map((x: any) => String(x.id)))
    if (!needPx || !ids.has(String(needPx.audience_id))) missing.push(needPx ? "đăng ký 180 ngày" : `tài khoản chưa có tệp đăng ký 180 ngày cho pixel ${pixel}`)
    if (!needBlk || !ids.has(String(needBlk.audience_id))) missing.push(needBlk ? "chặn POS mới" : "tài khoản chưa có tệp chặn POS mới")
  }
  steps.loai_tru = missing.length ? step("error", `Thiếu: ${[...new Set(missing)].join(", ")}`) : step("ok", "Đủ 2 tệp loại trừ")

  // 2. Cài đặt nhắm chọn
  const bad: string[] = []
  for (const s of adsets) {
    if (Number(s.targeting?.age_min || 18) < 25) bad.push(`tuổi tối thiểu ${s.targeting?.age_min || 18}`)
    if (Number(s.targeting?.targeting_automation?.advantage_audience ?? 0) !== 1) bad.push("tắt Advantage+ đối tượng")
  }
  steps.cai_dat = bad.length ? step("error", [...new Set(bad)].join(", ")) : step("ok", `Tuổi ≥25, Advantage+, pixel ${pixel || "?"}`)

  // 3. Seeding mọi post
  const tpl = sku ? await getTemplate(sku) : []
  const posts = new Map<string, string>() // post → link
  for (const a of detail.ads?.data || []) {
    const p = a.creative?.effective_object_story_id
    if (p && !posts.has(p)) posts.set(p, a.creative?.object_story_spec?.video_data?.call_to_action?.value?.link || "")
  }
  if (!tpl.length) steps.seeding = step("skip", `Chưa có mẫu seeding cho ${sku || "SP này"}`)
  else if (!posts.size) steps.seeding = step("pending", "Chưa thấy post của ad")
  else {
    let full = 0, err = ""
    for (const [post, link] of posts) {
      const pg = post.split("_")[0], tok = ctx.pageTok.get(pg)
      let mine = 0
      try { mine = ((await fbGet(`/${post}/comments?fields=from{id}&filter=toplevel&limit=100`, tok || token())).data || []).filter((x: any) => x.from?.id === pg).length } catch (e: any) { err = e.message }
      if (mine >= tpl.length) { full++; continue }
      // Seed dở dang (có vài bình luận của page) → không tự seed lại để tránh bình luận trùng, báo người kiểm
      if (mine > 0) { err = `post ${post} mới có ${mine}/${tpl.length} bình luận của page — kiểm tay`; continue }
      if (!ctx.seedWindow || !ctx.take()) continue
      const lk = /giadungphanviet|phanviet\.vn/.test(link) ? link : "https://www.giadungphanviet.shop/chaoultratitanmua1tang4"
      const r = await seedPost({ post_id: post, product_code: sku!, link: lk, by: "job:ads-launch-check" })
      if (r.status === "done" || r.status === "skipped") full++
      else err = r.error || r.status
    }
    steps.seeding = full === posts.size ? step("ok", `${full}/${posts.size} post đủ bình luận`)
      : step(err ? "error" : "pending", `${full}/${posts.size} post đủ bình luận${err ? ` — ${err}` : ctx.seedWindow ? " — đang seed dần" : " — chờ 7h"}`)
  }

  // 4. Tự scale
  const { rows: ts } = await pool.query(`SELECT enabled FROM auto_scale_camp WHERE campaign_id = $1`, [c.id])
  const { rows: removed } = await pool.query(
    `SELECT 1 FROM ads_rule_history WHERE kind='auto_scale_camp' AND ref=$1 AND new_value IS NULL LIMIT 1`, [c.id]
  ).catch(() => ({ rows: [] as any[] }))
  const rule = ruleFor(c.name)
  if (ts[0]) steps.tu_scale = step(ts[0].enabled ? "ok" : "skip", ts[0].enabled ? "Đã gắn" : "Gắn nhưng đang tạm dừng")
  else if (removed.length) steps.tu_scale = step("skip", "Đã bị gỡ khỏi Tự scale (đã quyết) — không tự gắn lại")
  else if (c.status !== "ACTIVE") steps.tu_scale = step("skip", `Camp đang ${c.status}`)
  else if (!rule) steps.tu_scale = step("skip", "Loại camp không dùng Tự scale (vd Messenger)")
  else {
    const { rows: cost } = await pool.query(`SELECT ad_account_id, daily_budget FROM mkt_ads_cost WHERE campaign_id=$1 ORDER BY date DESC LIMIT 1`, [c.id])
    if (!cost.length) steps.tu_scale = step("pending", "Chờ camp có chi tiêu để gắn")
    else {
      try {
        const fbc = await fbGet(`/${c.id}?fields=daily_budget`)
        const cur = Number(fbc.daily_budget || 0)
        if (!cur) steps.tu_scale = step("skip", "Camp ngân sách cấp nhóm (ABO) — Tự scale không hỗ trợ")
        else {
          const base = Math.min(cur, 300000) >= 50000 ? Math.min(cur, 300000) : 300000
          await pool.query(
            `INSERT INTO auto_scale_camp (campaign_id, rule_id, campaign_name, ad_account_id, mkt_name, base_budget, enabled, added_by)
             VALUES ($1,$2,$3,$4,$5,$6,true,'job:ads-launch-check') ON CONFLICT (campaign_id) DO NOTHING`,
            [c.id, rule, c.name, acc, mkt, base]
          )
          await pool.query(
            `INSERT INTO ads_rule_history (kind, ref, old_value, new_value, reason, changed_by) VALUES ('auto_scale_camp',$1,NULL,$2::jsonb,$3,'job:ads-launch-check')`,
            [c.id, JSON.stringify({ campaign_id: c.id, campaign_name: c.name, rule_id: rule, base_budget: base, enabled: true }), "Quy trình bắt buộc: camp mới chưa gắn Tự scale"]
          ).catch(() => {})
          steps.tu_scale = step("ok", `Tự gắn bộ ${rule}, nền ${base.toLocaleString("vi-VN")}đ`)
        }
      } catch (e: any) { steps.tu_scale = step("error", e.message) }
    }
  }

  // 5. Ghi theo dõi
  const { rows: la } = await pool.query(`SELECT mode FROM ads_launch WHERE campaign_id=$1`, [c.id])
  if (la.length) steps.theo_doi = step("ok", `Kiểu lên: ${la[0].mode}`)
  else {
    await registerLaunch({ campaign_id: c.id, campaign_name: c.name, product_code: sku, mkt_name: mkt, account_id: acc, page_id: [...posts.keys()][0]?.split("_")[0] || null,
      mode: "ngoai_quy_trinh", post_ids: [...posts.keys()], reason: "Camp lên ngoài công cụ của AI — job quy trình tự ghi nhận" }, "job:ads-launch-check")
    steps.theo_doi = step("ok", "Tự ghi (camp lên ngoài công cụ)")
  }
  return save(c, acc, mkt, steps, ctx.userModule)
}

async function save(c: any, acc: string, mkt: string | undefined, steps: Record<string, Step>, userModule?: any) {
  const pool = getPool()
  const vals = Object.values(steps)
  const status = vals.some((s) => s.status === "error") ? "error" : vals.some((s) => s.status === "pending") ? "pending" : "ok"
  const { rows: prev } = await pool.query(`SELECT notified FROM ads_launch_check WHERE campaign_id=$1`, [c.id])
  const notified: Record<string, string> = prev[0]?.notified || {}
  const newErr = Object.entries(steps).filter(([k, s]) => s.status === "error" && notified[k] !== s.detail)
  if (newErr.length && userModule && process.env.SUPER_ADMIN_EMAIL) {
    const text = `⚠️ Quy trình camp mới — có bước LỖI\n${c.name}\n` + newErr.map(([k, s]) => `• ${k}: ${s.detail}`).join("\n")
    await notifyTelegramByEmail(userModule, [process.env.SUPER_ADMIN_EMAIL], text, "ads_launch_check").catch(() => {})
    for (const [k, s] of newErr) notified[k] = s.detail
  }
  await pool.query(
    `INSERT INTO ads_launch_check (campaign_id, campaign_name, account_id, mkt_name, created_time, status, steps, notified, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,now())
     ON CONFLICT (campaign_id) DO UPDATE SET campaign_name=EXCLUDED.campaign_name, status=EXCLUDED.status, steps=EXCLUDED.steps,
       notified=EXCLUDED.notified, checked_at=now()`,
    [c.id, c.name, acc, mkt || null, c.created_time || null, status, JSON.stringify(steps), JSON.stringify(notified)]
  )
  return { campaign_id: c.id, name: c.name, status, steps }
}

export async function listChecks(days = 7) {
  await ensureCheckTable()
  const { rows } = await getPool().query(
    `SELECT * FROM ads_launch_check WHERE created_time > now() - ($1 || ' days')::interval ORDER BY created_time DESC`, [String(days)]
  )
  return rows
}
