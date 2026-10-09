// Tự scale camp theo giờ — kiểu XUANLT.
//
// Rà activity log Ads344 (40 ngày, 115 lần tăng): XUANLT giữ camp ở mức nền 300k,
// camp nào ra đơn trong ngày thì nhân 2–4 lần (cao điểm 12–15h, thêm 18–19h), ngày
// tốt nhất 22/09 đẩy 1tr → 2tr → 4tr → 8tr (23 đơn, 177k/đơn); khoảng 0h đưa hết
// về 300k. Module này làm lại đúng quy trình đó cho các camp ĐƯỢC GẮN bộ điều kiện.
//
// Chỉ camp CBO (ngân sách ở cấp campaign) — XUANLT scale ở cấp campaign.
// Mọi thay đổi gọi FB bằng FB_SYSTEM_TOKEN (đã kiểm chứng có quyền trên Ads344).

import { getPool } from "./db"
import { notifyTelegramByEmail } from "./notify"
import { decide, type Portfolio } from "./auto-scale-decide"
import { mktTotalsForDate, type MktTotal } from "./mkt-today"

const GRAPH = "https://graph.facebook.com/v25.0"

export type Rule = {
  id: number
  name: string
  target_cpa: number
  min_orders: number
  spend_ratio: number
  multiplier: number
  max_budget: number
  cooldown_min: number
  revert_factor: number
  hour_from: number
  hour_to: number
  nightly_reset: boolean
  dry_run: boolean
  active: boolean
  pause_enabled: boolean
  pause_day_spend: number
  pause_cost_pct: number
  pause_resume: boolean
  pause_max_streak: number
  pause_min_age_hours: number
  pause_dry_run: boolean
}

let _ready: Promise<void> | null = null

export function ensureTables(): Promise<void> {
  if (_ready) return _ready
  _ready = (async () => {
    const pool = getPool()
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_scale_rule (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        target_cpa BIGINT NOT NULL DEFAULT 200000,
        min_orders INT NOT NULL DEFAULT 2,
        spend_ratio NUMERIC(4,2) NOT NULL DEFAULT 1.00,  -- nhịp tiêu: 1 = cứ đà này sẽ tiêu hết ngân sách
        multiplier NUMERIC(4,2) NOT NULL DEFAULT 2,
        max_budget BIGINT NOT NULL DEFAULT 4000000,
        cooldown_min INT NOT NULL DEFAULT 120,
        revert_factor NUMERIC(4,2) NOT NULL DEFAULT 1.5,
        hour_from INT NOT NULL DEFAULT 9,
        hour_to INT NOT NULL DEFAULT 19,
        nightly_reset BOOLEAN NOT NULL DEFAULT true,
        dry_run BOOLEAN NOT NULL DEFAULT true,
        active BOOLEAN NOT NULL DEFAULT true,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS auto_scale_camp (
        campaign_id TEXT PRIMARY KEY,
        rule_id BIGINT NOT NULL,
        campaign_name TEXT,
        ad_account_id TEXT,
        mkt_name TEXT,
        base_budget BIGINT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        step_at TIMESTAMPTZ,       -- lần tăng gần nhất (thật) — để xét lùi
        step_from BIGINT,
        step_to BIGINT,
        step_spend BIGINT,         -- chi tiêu hôm nay tại thời điểm tăng
        last_checked_at TIMESTAMPTZ,
        last_reason TEXT,
        last_metrics JSONB,
        added_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS auto_scale_log (
        id BIGSERIAL PRIMARY KEY,
        campaign_id TEXT,
        campaign_name TEXT,
        rule_id BIGINT,
        action TEXT,               -- tang | lui | reset
        old_budget BIGINT,
        new_budget BIGINT,
        reason TEXT,
        metrics JSONB,
        dry_run BOOLEAN,
        success BOOLEAN,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_auto_scale_log_camp ON auto_scale_log (campaign_id, created_at DESC);
      -- Tự tắt camp lỗ (thêm 08/10/2026). Chế độ chạy thử RIÊNG với phần tăng ngân sách.
      ALTER TABLE auto_scale_rule ADD COLUMN IF NOT EXISTS pause_enabled BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE auto_scale_rule ADD COLUMN IF NOT EXISTS pause_day_spend BIGINT NOT NULL DEFAULT 300000;
      ALTER TABLE auto_scale_rule ADD COLUMN IF NOT EXISTS pause_cost_pct NUMERIC(5,1) NOT NULL DEFAULT 45;
      ALTER TABLE auto_scale_rule ADD COLUMN IF NOT EXISTS pause_resume BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE auto_scale_rule ADD COLUMN IF NOT EXISTS pause_max_streak INT NOT NULL DEFAULT 3;
      ALTER TABLE auto_scale_rule ADD COLUMN IF NOT EXISTS pause_min_age_hours INT NOT NULL DEFAULT 0;
      ALTER TABLE auto_scale_rule ADD COLUMN IF NOT EXISTS pause_dry_run BOOLEAN NOT NULL DEFAULT true;
      -- Quản lý tổng theo MKT (thêm 08/10/2026): giữ % chi phí cả MKT trong ngày quanh mục tiêu
      CREATE TABLE IF NOT EXISTS auto_scale_mkt (
        mkt_name TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT false,
        dry_run BOOLEAN NOT NULL DEFAULT true,       -- chỉ áp cho TỈA; giữ-chạy-thêm luôn thật khi bật
        max_pct NUMERIC(5,1) NOT NULL DEFAULT 27,     -- % chi phí tổng MKT hôm nay tối đa
        lenient_max_pct NUMERIC(5,1) NOT NULL DEFAULT 70,
        trim_hour INT NOT NULL DEFAULT 13,            -- từ giờ này bắt đầu tỉa nếu tổng > max_pct
        trim_spend BIGINT NOT NULL DEFAULT 0,         -- hoặc khi tổng chi MKT hôm nay đạt mức này (0 = chỉ theo giờ)
        trim_min_spend BIGINT NOT NULL DEFAULT 200000,-- camp phải chi ≥ mức này hôm nay mới bị tỉa
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      -- Camp chỉ bị tỉa khi % chi phí hôm nay của RIÊNG camp > mức này (09/10: tỉa theo max_pct 27%
      -- cắt cả camp đang 27–29% đúng mục tiêu, 7/9 camp bị tắt ở ~200k chi → mất đơn buổi tối)
      ALTER TABLE auto_scale_mkt ADD COLUMN IF NOT EXISTS trim_camp_pct NUMERIC(5,1) NOT NULL DEFAULT 40;
    `)
  })().catch((e) => { _ready = null; throw e })
  return _ready
}

// ── Thời gian VN ─────────────────────────────────────────────────────────────
export function nowVN() {
  const d = new Date(Date.now() + 7 * 3600_000)
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}
/** 00:00 hôm nay giờ VN, dạng timestamptz */
function startOfTodayVN(): string {
  return `${nowVN().date}T00:00:00+07:00`
}

function token(): string {
  return process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
}

export async function fbCampaign(campaignId: string): Promise<{ ok: boolean; data: any }> {
  try {
    const r = await fetch(`${GRAPH}/${campaignId}?fields=name,daily_budget,effective_status,account_id,created_time&access_token=${token()}`)
    const data: any = await r.json()
    return { ok: !data?.error, data }
  } catch (e: any) {
    return { ok: false, data: { error: { message: e.message } } }
  }
}

async function fbSetBudget(campaignId: string, budget: number): Promise<{ ok: boolean; data: any }> {
  try {
    const r = await fetch(`${GRAPH}/${campaignId}?daily_budget=${Math.round(budget)}&access_token=${token()}`, { method: "POST" })
    const data: any = await r.json()
    return { ok: !!data?.success && !data?.error, data }
  } catch (e: any) {
    return { ok: false, data: { error: { message: e.message } } }
  }
}

async function fbSetStatus(campaignId: string, status: "ACTIVE" | "PAUSED"): Promise<{ ok: boolean; data: any }> {
  try {
    const r = await fetch(`${GRAPH}/${campaignId}?status=${status}&access_token=${token()}`, { method: "POST" })
    const data: any = await r.json()
    return { ok: !!data?.success && !data?.error, data }
  } catch (e: any) {
    return { ok: false, data: { error: { message: e.message } } }
  }
}

// ── Số liệu hôm nay ──────────────────────────────────────────────────────────
// Đơn hợp lệ: bỏ đơn trùng, bỏ đơn nháp chưa ai xác nhận, bỏ đơn huỷ/xoá.
// Đơn Webcake mới về ở status 0 (Chờ xử lý) — vẫn tính, vì đó là đơn thật chưa gọi.
const DON_HOP_LE = `
  deleted_at IS NULL
  AND NOT (tags @> '[{"name":"Đơn trùng"}]'::jsonb)
  AND NOT (tags @> '[{"name":"Đơn nháp"}]'::jsonb AND status IN (0, 11, 6, 7, -1))
  AND status NOT IN (6, 7, -1)
`

async function ordersSince(campaignId: string, campaignName: string, since: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int n FROM pancake_order
      WHERE (raw->>'p_utm_campaign' = $1
             -- Tên camp chỉ dùng khi đơn không mang ID camp: XUANLT có nhiều camp TRÙNG TÊN,
             -- ghép theo tên sẽ cộng đơn của camp này sang camp kia.
             OR (COALESCE(raw->>'p_utm_campaign','') !~ '^[0-9]{10,}$' AND raw->>'p_utm_source' = $2))
        AND pancake_created_at >= $3::timestamptz AND ${DON_HOP_LE}`,
    [campaignId, campaignName, since]
  )
  return rows[0]?.n ?? 0
}

async function spendToday(campaignId: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COALESCE(SUM(spend),0)::bigint s FROM mkt_ads_cost
      WHERE campaign_id = $1 AND deleted_at IS NULL AND date = $2::date`,
    [campaignId, nowVN().date]
  )
  return Number(rows[0]?.s ?? 0)
}

/** CTR hôm nay của camp (%) — null khi chưa có hiển thị. */
async function ctrToday(campaignId: string): Promise<number | null> {
  const { rows } = await getPool().query(
    `SELECT COALESCE(SUM(impressions),0)::bigint i, COALESCE(SUM(clicks),0)::bigint c FROM mkt_ads_cost
      WHERE campaign_id = $1 AND deleted_at IS NULL AND date = $2::date`,
    [campaignId, nowVN().date]
  )
  const i = Number(rows[0]?.i ?? 0)
  return i > 0 ? (Number(rows[0].c) / i) * 100 : null
}

export type MktSetting = {
  mkt_name: string; enabled: boolean; dry_run: boolean; max_pct: number; lenient_max_pct: number
  trim_hour: number; trim_spend: number; trim_min_spend: number; trim_camp_pct: number
}
type PortfolioCtx = { setting: MktSetting; total: MktTotal; ctr_base: number | null; trim_active: boolean; pick: string | null; pick_reason?: string }

/**
 * Bối cảnh tổng theo MKT cho 1 vòng xét: % chi phí cả MKT hôm nay, CTR 7 ngày của MKT, có đang
 * giờ tỉa không, và camp xấu nhất được chọn tỉa vòng này (mỗi MKT tối đa 1 camp / 15 phút).
 */
async function loadPortfolios(hour: number): Promise<Map<string, PortfolioCtx>> {
  const pool = getPool()
  const out = new Map<string, PortfolioCtx>()
  const { rows: settings } = await pool.query(`SELECT * FROM auto_scale_mkt WHERE enabled`)
  if (!settings.length) return out
  const today = nowVN().date
  const totals = await mktTotalsForDate(today)

  for (const raw of settings) {
    const setting: MktSetting = {
      ...raw, max_pct: Number(raw.max_pct), lenient_max_pct: Number(raw.lenient_max_pct),
      trim_hour: Number(raw.trim_hour), trim_spend: Number(raw.trim_spend), trim_min_spend: Number(raw.trim_min_spend),
      trim_camp_pct: Number(raw.trim_camp_pct ?? 40),
    }
    const mkt = setting.mkt_name
    const total = totals[mkt] || { spend: 0, revenue: 0, orders: 0, pct: null }
    const { rows: base } = await pool.query(
      `SELECT COALESCE(SUM(impressions),0)::bigint i, COALESCE(SUM(clicks),0)::bigint c FROM mkt_ads_cost
        WHERE mkt_name = $1 AND deleted_at IS NULL AND date >= $2::date - 7 AND date < $2::date`,
      [mkt, today]
    )
    const ctr_base = Number(base[0]?.i) > 0 ? (Number(base[0].c) / Number(base[0].i)) * 100 : null
    const trim_active = hour >= setting.trim_hour || (setting.trim_spend > 0 && total.spend >= setting.trim_spend)
    const ctx: PortfolioCtx = { setting, total, ctr_base, trim_active, pick: null }
    out.set(mkt, ctx)

    const bad = total.pct === null ? total.spend > 0 : total.pct > setting.max_pct
    if (!trim_active || !bad) continue

    // Ứng viên tỉa: camp đã gắn, bộ điều kiện bật phanh, đang chạy, chi đủ mẫu, % hôm nay > mục tiêu,
    // chưa bị hệ thống tắt hôm nay (người bật lại thì tôn trọng tới hết ngày).
    const { rows: camps } = await pool.query(
      `SELECT c.campaign_id, c.campaign_name, c.rule_id FROM auto_scale_camp c
         JOIN auto_scale_rule r ON r.id = c.rule_id
        WHERE c.enabled AND r.active AND r.pause_enabled AND c.mkt_name = $1
          AND EXISTS (SELECT 1 FROM mkt_ads_cost m WHERE m.campaign_id = c.campaign_id AND m.date = $2::date AND m.effective_status = 'ACTIVE')
          AND NOT EXISTS (SELECT 1 FROM auto_scale_log l WHERE l.campaign_id = c.campaign_id AND l.action = 'tat' AND l.success
                          AND l.created_at >= $3::timestamptz AND (NOT l.dry_run OR $4))`,
      [mkt, today, startOfTodayVN(), setting.dry_run]
    )
    let worst: { id: string; name: string; rule_id: number; pct: number; spend: number; rev: number } | null = null
    for (const c of camps) {
      const spend = await spendToday(c.campaign_id)
      if (spend < setting.trim_min_spend) continue
      const rev = await revenueSince(c.campaign_id, c.campaign_name, startOfTodayVN())
      const pct = rev > 0 ? (spend / rev) * 100 : Infinity
      if (pct <= setting.trim_camp_pct) continue
      if (!worst || pct > worst.pct || (pct === worst.pct && spend > worst.spend)) {
        worst = { id: c.campaign_id, name: c.campaign_name, rule_id: Number(c.rule_id), pct, spend, rev }
      }
    }
    if (!worst) continue
    if (setting.dry_run) {
      // Chạy thử: ghi "lẽ ra đã tỉa" (mỗi camp 1 lần/ngày nhờ điều kiện NOT EXISTS ở trên)
      await pool.query(
        `INSERT INTO auto_scale_log (campaign_id, campaign_name, rule_id, action, reason, metrics, dry_run, success)
         VALUES ($1,$2,$3,'tat',$4,$5::jsonb,true,true)`,
        [worst.id, worst.name, worst.rule_id,
         `Tỉa (chạy thử): tổng ${mkt} hôm nay ${total.pct ?? "—"}% > ${setting.max_pct}% — camp xấu nhất (chi ${vnd(worst.spend)}, ${Number.isFinite(worst.pct) ? worst.pct.toFixed(0) + "%" : "chưa có doanh số"})`,
         JSON.stringify({ mkt_total: total, spend_today: worst.spend, revenue_today: worst.rev })]
      ).catch(() => {})
      continue
    }
    ctx.pick = worst.id
  }
  return out
}

/** Doanh số hôm nay của camp — cùng cách ghép đơn với ordersSince, cùng cách tính cod_total của báo cáo. */
async function revenueSince(campaignId: string, campaignName: string, since: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COALESCE(SUM(cod_amount),0)::bigint s FROM pancake_order
      WHERE (raw->>'p_utm_campaign' = $1
             OR (COALESCE(raw->>'p_utm_campaign','') !~ '^[0-9]{10,}$' AND raw->>'p_utm_source' = $2))
        AND pancake_created_at >= $3::timestamptz AND ${DON_HOP_LE}`,
    [campaignId, campaignName, since]
  )
  return Number(rows[0]?.s ?? 0)
}

/**
 * Lịch sử phanh của camp: hôm nay đã phanh chưa, hôm qua có phanh không, chuỗi ngày phanh liên tiếp
 * (kết thúc hôm qua), đã tự bật lại hôm nay chưa, và sau lần phanh gần nhất có ai thao tác tay không.
 */
async function pauseHistory(campaignId: string) {
  const pool = getPool()
  const today = nowVN().date
  const { rows } = await pool.query(
    `SELECT DISTINCT (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text d FROM auto_scale_log
      WHERE campaign_id = $1 AND action = 'tat' AND NOT dry_run AND success AND created_at > now() - interval '15 days'`,
    [campaignId]
  )
  const days = new Set(rows.map((r: any) => r.d))
  const dayStr = (back: number) => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - back)
    return d.toISOString().slice(0, 10)
  }
  let streak = 0
  while (days.has(dayStr(streak + 1))) streak++
  const { rows: res } = await pool.query(
    `SELECT 1 FROM auto_scale_log WHERE campaign_id = $1 AND action = 'bat' AND success AND created_at >= $2::timestamptz LIMIT 1`,
    [campaignId, startOfTodayVN()]
  )
  // Người tự bật/tắt sau lần phanh gần nhất → không tự bật lại (người đã quyết)
  const { rows: manual } = await pool.query(
    `SELECT 1 FROM camp_action_log
      WHERE campaign_id = $1 AND action IN ('pause','activate') AND source <> 'auto_scale'
        AND created_at > (SELECT MAX(created_at) FROM auto_scale_log WHERE campaign_id = $1 AND action = 'tat' AND NOT dry_run AND success)
      LIMIT 1`,
    [campaignId]
  ).catch(() => ({ rows: [] as any[] }))
  return {
    paused_today: days.has(today),
    auto_paused_yesterday: days.has(dayStr(1)) && manual.length === 0,
    pause_streak: streak,
    resumed_today: res.length > 0,
  }
}

/** Tài khoản đang sát ngưỡng thanh toán hoặc lỗi → không tăng thêm. */
/** Tài khoản trả trước có tự nạp khi số dư dưới 1tr (xác nhận 09/10/2026) — ADS342 của ANHTD. */
const AUTO_TOPUP_ACCOUNTS = new Set(["741222868885235"])

async function accountBlocked(adAccountId: string | null, increase = 0): Promise<string | null> {
  if (!adAccountId) return null
  const id = adAccountId.replace(/^act_/, "")
  const { rows } = await getPool().query(
    `SELECT muc, ma_van_de, mo_ta, con_lai FROM fb_account_health
      WHERE (account_id = $1 OR account_id = 'act_' || $1) AND checked_at > now() - interval '3 hours'
      ORDER BY checked_at DESC LIMIT 1`,
    [id]
  ).catch(() => ({ rows: [] as any[] }))
  const h = rows[0]
  if (!h) return null
  if (h.muc === "do" || ["sap_tru_tien_gap", "da_vuot_nguong"].includes(h.ma_van_de)) {
    return `Tài khoản đang cảnh báo đỏ (${h.ma_van_de || h.muc})`
  }
  // Tài khoản tự nạp khi số dư dưới 1tr: cảnh báo vàng "sắp hết hạn mức" là bình thường, không chặn tăng.
  // Cảnh báo đỏ ở trên vẫn chặn.
  if (AUTO_TOPUP_ACCOUNTS.has(id)) return null
  // Tài khoản trả trước / hạn mức sắp hết: tăng ngân sách vô ích, FB sẽ ngừng phân phối
  // (05/10 Ads342 báo vàng "sắp hết hạn mức" — tăng lên 1,2tr xong cả tài khoản đứng từ 13h).
  if (h.muc === "vang" && /han_muc|het_tien|nap|so_du/.test(String(h.ma_van_de || ""))) {
    return `Tài khoản sắp hết tiền/hạn mức (${h.mo_ta || h.ma_van_de}) — nạp thêm trước khi tăng`
  }
  if (h.con_lai !== null && h.con_lai !== undefined && Number(h.con_lai) < 3 * increase) {
    return `Hạn mức tài khoản còn ${Math.round(Number(h.con_lai)).toLocaleString("vi-VN")}đ — không đủ để tăng`
  }
  return null
}

// ── Người nhận Telegram ──────────────────────────────────────────────────────
async function emailsForMkt(userModule: any, mkt: string | null): Promise<string[]> {
  const out = new Set<string>()
  if (process.env.SUPER_ADMIN_EMAIL) out.add(process.env.SUPER_ADMIN_EMAIL)
  if (!mkt) return [...out]
  try {
    const users = await userModule.listUsers({}, { select: ["email", "metadata"] })
    for (const u of users) {
      const m = (u.metadata as any) || {}
      const list: string[] = Array.isArray(m.mkt_codes) && m.mkt_codes.length ? m.mkt_codes : m.mkt_code ? [m.mkt_code] : []
      if (list.includes(mkt) && u.email) out.add(u.email)
    }
  } catch {}
  return [...out]
}

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`

// ── Thực thi 1 thay đổi ngân sách (hoặc ghi lại nếu chạy thử) ────────────────
async function apply(opts: {
  camp: any; rule: Rule; action: "tang" | "lui" | "reset"; from: number; to: number
  reason: string; metrics: any; userModule?: any
}): Promise<boolean> {
  const { camp, rule, action, from, to, reason, metrics } = opts
  const pool = getPool()
  let ok = true
  let err: string | null = null

  if (!rule.dry_run) {
    const r = await fbSetBudget(camp.campaign_id, to)
    ok = r.ok
    err = ok ? null : String(r.data?.error?.error_user_msg || r.data?.error?.message || "FB error").slice(0, 300)
    if (ok) {
      await pool.query(
        `UPDATE mkt_ads_cost SET daily_budget = $1, updated_at = now() WHERE campaign_id = $2 AND date = $3::date`,
        [to, camp.campaign_id, nowVN().date]
      ).catch(() => {})
      await pool.query(
        `INSERT INTO camp_action_log (campaign_id, campaign_name, action, old_value, new_value, source, user_email, fb_response, success)
         VALUES ($1,$2,'set_budget',$3::jsonb,$4::jsonb,'auto_scale',$5,$6::jsonb,true)`,
        [camp.campaign_id, camp.campaign_name, JSON.stringify({ daily_budget: from }), JSON.stringify({ daily_budget: to }),
         `auto-scale:${rule.name}`, JSON.stringify(r.data)]
      ).catch(() => {})
      if (action === "tang") {
        await pool.query(
          `UPDATE auto_scale_camp SET step_at = now(), step_from = $2, step_to = $3, step_spend = $4, updated_at = now() WHERE campaign_id = $1`,
          [camp.campaign_id, from, to, metrics.spend_today]
        )
      } else {
        await pool.query(
          `UPDATE auto_scale_camp SET step_at = NULL, step_from = NULL, step_to = NULL, step_spend = NULL, updated_at = now() WHERE campaign_id = $1`,
          [camp.campaign_id]
        )
      }
    }
  }

  await pool.query(
    `INSERT INTO auto_scale_log (campaign_id, campaign_name, rule_id, action, old_budget, new_budget, reason, metrics, dry_run, success, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
    [camp.campaign_id, camp.campaign_name, rule.id, action, from, to, reason, JSON.stringify(metrics), rule.dry_run, ok, err]
  )

  if (opts.userModule) {
    const icon = action === "tang" ? "🚀" : action === "lui" ? "↩️" : "🌙"
    const label = action === "tang" ? "TĂNG" : action === "lui" ? "LÙI" : "RESET"
    const text =
      `${icon} Tự scale — ${label}${rule.dry_run ? " (CHẠY THỬ, chưa đổi thật)" : ""}\n` +
      `${camp.campaign_name}\n` +
      `Ngân sách: ${vnd(from)} → ${vnd(to)}${ok ? "" : ` — LỖI: ${err}`}\n` +
      `Lý do: ${reason}\n` +
      `Bộ điều kiện: ${rule.name}`
    const emails = await emailsForMkt(opts.userModule, camp.mkt_name)
    await notifyTelegramByEmail(opts.userModule, emails, text, "auto_scale").catch(() => {})
  }
  return ok
}

// ── Phanh (tắt) / bật lại camp (hoặc ghi lại nếu chạy thử) ───────────────────
async function applyStatus(opts: {
  camp: any; rule: Rule; action: "tat" | "bat"; budget: number; to?: number; final?: boolean
  reason: string; metrics: any; userModule?: any
}): Promise<boolean> {
  const { camp, rule, action, budget, reason, metrics } = opts
  const pool = getPool()
  const dry = rule.pause_dry_run
  const status = action === "tat" ? "PAUSED" : "ACTIVE"
  let ok = true
  let err: string | null = null
  if (!dry) {
    // Bật lại: đưa ngân sách về mức nền trước (reset đêm đã làm, đây là chốt chặn)
    if (action === "bat" && opts.to && opts.to !== budget) await fbSetBudget(camp.campaign_id, opts.to)
    const r = await fbSetStatus(camp.campaign_id, status)
    ok = r.ok
    err = ok ? null : String(r.data?.error?.error_user_msg || r.data?.error?.message || "FB error").slice(0, 300)
    if (ok) {
      await pool.query(
        `UPDATE mkt_ads_cost SET effective_status = $1, updated_at = now() WHERE campaign_id = $2 AND date = $3::date`,
        [status, camp.campaign_id, nowVN().date]
      ).catch(() => {})
      await pool.query(
        `INSERT INTO camp_action_log (campaign_id, campaign_name, action, old_value, new_value, source, user_email, fb_response, success)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'auto_scale',$6,$7::jsonb,true)`,
        [camp.campaign_id, camp.campaign_name, action === "tat" ? "pause" : "activate",
         JSON.stringify({ status: action === "tat" ? "ACTIVE" : "PAUSED" }), JSON.stringify({ status }),
         `auto-scale:${rule.name}`, JSON.stringify(r.data)]
      ).catch(() => {})
      await pool.query(
        `UPDATE auto_scale_camp SET step_at=NULL, step_from=NULL, step_to=NULL, step_spend=NULL, updated_at=now() WHERE campaign_id=$1`,
        [camp.campaign_id]
      ).catch(() => {})
    }
  }
  await pool.query(
    `INSERT INTO auto_scale_log (campaign_id, campaign_name, rule_id, action, old_budget, new_budget, reason, metrics, dry_run, success, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
    [camp.campaign_id, camp.campaign_name, rule.id, action, budget, opts.to ?? budget, reason, JSON.stringify(metrics), dry, ok, err]
  )
  if (opts.userModule) {
    const head = action === "tat"
      ? `⛔ Tự scale — PHANH NGÀY XẤU (tắt camp)${dry ? " (CHẠY THỬ, chưa tắt thật)" : ""}`
      : `▶️ Tự scale — BẬT LẠI camp (ngày mới)`
    const tail = action === "tat"
      ? (opts.final
          ? `⚠️ Xấu ${rule.pause_max_streak} ngày liên tiếp — sẽ KHÔNG tự bật lại, cần người quyết.`
          : `Sáng mai 0h30 hệ thống tự bật lại ở mức nền. Muốn chạy tiếp ngay thì bật tay (hệ thống không tắt lại trong hôm nay).`)
      : `Ngân sách: ${vnd(opts.to ?? budget)}`
    const text =
      `${head}\n${camp.campaign_name}\nLý do: ${reason}${ok ? "" : ` — LỖI: ${err}`}\n${tail}\nBộ điều kiện: ${rule.name}`
    const emails = await emailsForMkt(opts.userModule, camp.mkt_name)
    await notifyTelegramByEmail(opts.userModule, emails, text, "auto_scale").catch(() => {})
  }
  return ok
}

async function lastActionAt(campaignId: string, dryRun: boolean): Promise<Date | null> {
  const { rows } = await getPool().query(
    `SELECT created_at FROM auto_scale_log
      WHERE campaign_id = $1 AND action IN ('tang','lui') AND dry_run = $2 AND success
        AND created_at >= $3::timestamptz
      ORDER BY created_at DESC LIMIT 1`,
    [campaignId, dryRun, startOfTodayVN()]
  )
  return rows[0]?.created_at ? new Date(rows[0].created_at) : null
}

async function resetDoneToday(campaignId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM auto_scale_log WHERE campaign_id = $1 AND action = 'reset' AND created_at >= $2::timestamptz LIMIT 1`,
    [campaignId, startOfTodayVN()]
  )
  return rows.length > 0
}

async function revertedToday(campaignId: string, dryRun: boolean): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM auto_scale_log WHERE campaign_id = $1 AND action = 'lui' AND dry_run = $2 AND success
        AND created_at >= $3::timestamptz LIMIT 1`,
    [campaignId, dryRun, startOfTodayVN()]
  )
  return rows.length > 0
}

/** Chi tiêu cộng dồn hôm nay ở snapshot giờ (camp_hourly_snapshot, chụp lúc hh:05) cách đây ~2h. */
async function spendSnapshot(campaignId: string, hour: number, minute: number) {
  const target = hour - 2
  if (target < 0) return { spend_2h_ago: null, minutes_since_snapshot: null }
  const { rows } = await getPool().query(
    `SELECT hour, spend FROM camp_hourly_snapshot
      WHERE date = $1::date AND campaign_id = $2 AND hour BETWEEN $3 AND $4
      ORDER BY hour DESC LIMIT 1`,
    [nowVN().date, campaignId, Math.max(0, target - 1), target]
  ).catch(() => ({ rows: [] as any[] }))
  if (!rows.length) return { spend_2h_ago: null, minutes_since_snapshot: null }
  const snapMin = Number(rows[0].hour) * 60 + 5
  return { spend_2h_ago: Number(rows[0].spend), minutes_since_snapshot: hour * 60 + minute - snapMin }
}

async function note(campaignId: string, reason: string, metrics: any) {
  await getPool().query(
    `UPDATE auto_scale_camp SET last_checked_at = now(), last_reason = $2, last_metrics = $3::jsonb WHERE campaign_id = $1`,
    [campaignId, reason, JSON.stringify(metrics)]
  ).catch(() => {})
}

// ── Vòng đánh giá chính ──────────────────────────────────────────────────────
export async function runAutoScale(userModule?: any, onlyCampaignId?: string): Promise<{ checked: number; actions: number }> {
  await ensureTables()
  const pool = getPool()
  const { hour, minute } = nowVN()
  const { rows: camps } = await pool.query(
    `SELECT c.*, row_to_json(r.*) AS rule FROM auto_scale_camp c
       JOIN auto_scale_rule r ON r.id = c.rule_id
      WHERE c.enabled AND r.active ${onlyCampaignId ? "AND c.campaign_id = $1" : ""}`,
    onlyCampaignId ? [onlyCampaignId] : []
  )
  let actions = 0
  // Bối cảnh tổng theo MKT — tính 1 lần/vòng cho mọi camp (kể cả khi chỉ xét 1 camp)
  const portfolios = await loadPortfolios(hour).catch((e) => {
    console.error("[AutoScale] portfolio error:", e.message)
    return new Map<string, PortfolioCtx>()
  })

  for (const camp of camps) {
    const rule: Rule = {
      ...camp.rule,
      target_cpa: Number(camp.rule.target_cpa), min_orders: Number(camp.rule.min_orders),
      spend_ratio: Number(camp.rule.spend_ratio), multiplier: Number(camp.rule.multiplier),
      max_budget: Number(camp.rule.max_budget), cooldown_min: Number(camp.rule.cooldown_min),
      revert_factor: Number(camp.rule.revert_factor),
      pause_day_spend: Number(camp.rule.pause_day_spend || 0), pause_cost_pct: Number(camp.rule.pause_cost_pct || 0),
      pause_max_streak: Number(camp.rule.pause_max_streak || 3), pause_min_age_hours: Number(camp.rule.pause_min_age_hours || 0),
    }
    const base = Number(camp.base_budget)

    const fb = await fbCampaign(camp.campaign_id)
    if (!fb.ok) { await note(camp.campaign_id, `Không đọc được camp trên FB: ${fb.data?.error?.message ?? ""}`, {}); continue }
    const cur = Number(fb.data.daily_budget || 0)
    if (!cur) { await note(camp.campaign_id, "Camp không có ngân sách cấp campaign (ABO) — không hỗ trợ", {}); continue }
    if (fb.data.name && fb.data.name !== camp.campaign_name) {
      await pool.query(`UPDATE auto_scale_camp SET campaign_name = $2 WHERE campaign_id = $1`, [camp.campaign_id, fb.data.name]).catch(() => {})
      camp.campaign_name = fb.data.name
    }

    const spend = await spendToday(camp.campaign_id)
    const orders = await ordersSince(camp.campaign_id, camp.campaign_name, startOfTodayVN())
    const cpa = orders > 0 ? Math.round(spend / orders) : null
    const metrics: any = { budget: cur, base, spend_today: spend, orders_today: orders, cpa_today: cpa, hour: `${hour}:${String(minute).padStart(2, "0")}` }

    // Lần tăng gần nhất — chỉ tính nếu xảy ra HÔM NAY (tắt reset đêm thì state hôm qua còn sót)
    const stepAt = camp.step_at ? new Date(camp.step_at) : null
    const stepToday = stepAt && stepAt.getTime() >= new Date(startOfTodayVN()).getTime()
    const step = stepToday && stepAt ? {
      from: Number(camp.step_from), to: Number(camp.step_to), spend_at_step: Number(camp.step_spend || 0),
      minutes_ago: Math.floor((Date.now() - stepAt.getTime()) / 60_000),
      orders_since: await ordersSince(camp.campaign_id, camp.campaign_name, stepAt.toISOString()),
    } : null
    if (step) metrics.since_step = { spend: spend - step.spend_at_step, orders: step.orders_since }
    const last = await lastActionAt(camp.campaign_id, rule.dry_run)

    let pauseInputs: any = {}
    if (rule.pause_enabled) {
      const created = fb.data.created_time ? new Date(fb.data.created_time).getTime() : NaN
      pauseInputs = {
        revenue_today: await revenueSince(camp.campaign_id, camp.campaign_name, startOfTodayVN()),
        camp_age_hours: Number.isFinite(created) ? (Date.now() - created) / 3_600_000 : null,
        ...(await pauseHistory(camp.campaign_id)),
      }
      metrics.revenue_today = pauseInputs.revenue_today
      metrics.cost_pct_today = pauseInputs.revenue_today ? Math.round((spend / pauseInputs.revenue_today) * 1000) / 10 : null
      const ctx = camp.mkt_name ? portfolios.get(camp.mkt_name) : undefined
      if (ctx) {
        const ctr = await ctrToday(camp.campaign_id)
        const portfolio: Portfolio = {
          mkt: camp.mkt_name, pct: ctx.total.pct, max_pct: ctx.setting.max_pct, lenient_max_pct: ctx.setting.lenient_max_pct,
          trim_active: ctx.trim_active, trim_pick: ctx.pick === camp.campaign_id, ctr, ctr_base: ctx.ctr_base,
        }
        pauseInputs.portfolio = portfolio
        metrics.mkt = { pct: ctx.total.pct, spend: ctx.total.spend, revenue: ctx.total.revenue, trim_active: ctx.trim_active, ctr, ctr_base: ctx.ctr_base }
      }
    }

    const d = decide({
      hour, minute, rule, base, budget: cur, status: fb.data.effective_status,
      spend_today: spend, orders_today: orders, step,
      minutes_since_last_action: last ? Math.floor((Date.now() - last.getTime()) / 60_000) : null,
      reverted_today: await revertedToday(camp.campaign_id, rule.dry_run),
      reset_done_today: await resetDoneToday(camp.campaign_id),
      account_block: await accountBlocked(camp.ad_account_id, Math.max(0, Math.min(cur * rule.multiplier, rule.max_budget) - cur)),
      ...(await spendSnapshot(camp.campaign_id, hour, minute)),
      ...pauseInputs,
    })

    if (d.action === "none") { await note(camp.campaign_id, d.reason, metrics); continue }

    if (d.action === "tat" || d.action === "bat") {
      if (await applyStatus({
        camp, rule, action: d.action, budget: cur, to: d.action === "bat" ? d.to : undefined,
        final: d.action === "tat" ? d.final : undefined, reason: d.reason, metrics, userModule,
      })) actions++
      const nhan = d.action === "tat" ? (rule.pause_dry_run ? "Lẽ ra đã phanh" : "Đã phanh (tắt)") : "Đã bật lại"
      await note(camp.campaign_id, `${nhan}: ${d.reason}`, metrics)
      continue
    }

    if (d.action === "reset" && d.to === cur) {
      // Đã ở mức nền — chỉ đánh dấu đã reset + xoá state bước tăng
      await pool.query(
        `INSERT INTO auto_scale_log (campaign_id, campaign_name, rule_id, action, old_budget, new_budget, reason, dry_run, success)
         VALUES ($1,$2,$3,'reset',$4,$4,$5,$6,true)`,
        [camp.campaign_id, camp.campaign_name, rule.id, cur, d.reason, rule.dry_run]
      )
      await pool.query(`UPDATE auto_scale_camp SET step_at=NULL, step_from=NULL, step_to=NULL, step_spend=NULL WHERE campaign_id=$1`, [camp.campaign_id])
      await note(camp.campaign_id, d.reason, metrics)
      continue
    }

    if (await apply({ camp, rule, action: d.action, from: cur, to: d.to, reason: d.reason, metrics, userModule })) actions++
    const nhan = d.action === "tang" ? (rule.dry_run ? "Lẽ ra đã tăng" : "Đã tăng") : d.action === "lui" ? (rule.dry_run ? "Lẽ ra đã lùi" : "Đã lùi") : (rule.dry_run ? "Lẽ ra đã reset" : "Đã reset")
    await note(camp.campaign_id, `${nhan} ${vnd(cur)} → ${vnd(d.to)}: ${d.reason}`, metrics)
  }
  return { checked: camps.length, actions }
}
