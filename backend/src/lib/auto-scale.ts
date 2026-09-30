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
        spend_ratio NUMERIC(4,2) NOT NULL DEFAULT 0.70,
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
    const r = await fetch(`${GRAPH}/${campaignId}?fields=name,daily_budget,effective_status,account_id&access_token=${token()}`)
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
      WHERE (raw->>'p_utm_campaign' = $1 OR raw->>'p_utm_source' = $2)
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

/** Tài khoản đang sát ngưỡng thanh toán hoặc lỗi → không tăng thêm. */
async function accountBlocked(adAccountId: string | null): Promise<string | null> {
  if (!adAccountId) return null
  const id = adAccountId.replace(/^act_/, "")
  const { rows } = await getPool().query(
    `SELECT muc, ma_van_de, mo_ta FROM fb_account_health
      WHERE (account_id = $1 OR account_id = 'act_' || $1) AND checked_at > now() - interval '3 hours'
      ORDER BY checked_at DESC LIMIT 1`,
    [id]
  ).catch(() => ({ rows: [] as any[] }))
  const h = rows[0]
  if (!h) return null
  if (h.muc === "do" || ["sap_tru_tien_gap", "da_vuot_nguong"].includes(h.ma_van_de)) {
    return `Tài khoản đang cảnh báo đỏ (${h.ma_van_de || h.muc})`
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

  for (const camp of camps) {
    const rule: Rule = {
      ...camp.rule,
      target_cpa: Number(camp.rule.target_cpa), min_orders: Number(camp.rule.min_orders),
      spend_ratio: Number(camp.rule.spend_ratio), multiplier: Number(camp.rule.multiplier),
      max_budget: Number(camp.rule.max_budget), cooldown_min: Number(camp.rule.cooldown_min),
      revert_factor: Number(camp.rule.revert_factor),
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

    // 1. Reset đêm: từ 00:30 tới 06:00, mỗi camp 1 lần/ngày
    if (rule.nightly_reset && hour < 6 && (hour > 0 || minute >= 30)) {
      if (!(await resetDoneToday(camp.campaign_id))) {
        const m = { budget: cur, base }
        if (cur !== base) {
          if (await apply({ camp, rule, action: "reset", from: cur, to: base, reason: "Reset đêm về mức nền", metrics: m, userModule })) actions++
        } else {
          await pool.query(
            `INSERT INTO auto_scale_log (campaign_id, campaign_name, rule_id, action, old_budget, new_budget, reason, dry_run, success)
             VALUES ($1,$2,$3,'reset',$4,$4,'Đã ở mức nền',$5,true)`,
            [camp.campaign_id, camp.campaign_name, rule.id, cur, rule.dry_run]
          )
          await pool.query(`UPDATE auto_scale_camp SET step_at=NULL, step_from=NULL, step_to=NULL, step_spend=NULL WHERE campaign_id=$1`, [camp.campaign_id])
        }
      }
      continue
    }

    if (hour < rule.hour_from || hour >= rule.hour_to) { await note(camp.campaign_id, `Ngoài khung giờ ${rule.hour_from}h–${rule.hour_to}h`, { budget: cur }); continue }
    if (fb.data.effective_status !== "ACTIVE") { await note(camp.campaign_id, `Camp đang ${fb.data.effective_status}`, { budget: cur }); continue }

    const spend = await spendToday(camp.campaign_id)
    const orders = await ordersSince(camp.campaign_id, camp.campaign_name, startOfTodayVN())
    const cpa = orders > 0 ? Math.round(spend / orders) : null
    const metrics: any = { budget: cur, base, spend_today: spend, orders_today: orders, cpa_today: cpa, hour: `${hour}:${String(minute).padStart(2, "0")}` }

    // 2. Lùi: sau lần tăng gần nhất mà đơn không về tương xứng
    if (camp.step_at && Number(camp.step_to) === cur && Date.now() - new Date(camp.step_at).getTime() >= 60 * 60_000) {
      const dSpend = spend - Number(camp.step_spend || 0)
      const dOrders = await ordersSince(camp.campaign_id, camp.campaign_name, new Date(camp.step_at).toISOString())
      const nguong = rule.target_cpa * rule.revert_factor
      metrics.since_step = { spend: dSpend, orders: dOrders }
      const xau = dSpend >= rule.target_cpa && (dOrders === 0 ? dSpend >= nguong : dSpend / dOrders > nguong)
      if (xau) {
        const to = Math.max(base, Number(camp.step_from || base))
        if (to < cur) {
          const reason = `Từ lần tăng: chi ${vnd(dSpend)}, ${dOrders} đơn (vượt ${vnd(nguong)}/đơn)`
          if (await apply({ camp, rule, action: "lui", from: cur, to, reason, metrics, userModule })) actions++
          await note(camp.campaign_id, `Đã lùi: ${reason}`, metrics)
          continue
        }
      }
    }

    // 3. Tăng
    const lyDo: string[] = []
    if (orders < rule.min_orders) lyDo.push(`mới ${orders}/${rule.min_orders} đơn`)
    if (cpa === null || cpa > rule.target_cpa) lyDo.push(`CPA ${cpa === null ? "—" : vnd(cpa)} > ${vnd(rule.target_cpa)}`)
    if (spend < rule.spend_ratio * cur) lyDo.push(`đã tiêu ${Math.round((spend / cur) * 100)}% < ${Math.round(rule.spend_ratio * 100)}% ngân sách`)
    const last = await lastActionAt(camp.campaign_id, rule.dry_run)
    if (last && Date.now() - last.getTime() < rule.cooldown_min * 60_000) {
      lyDo.push(`chờ ${rule.cooldown_min - Math.floor((Date.now() - last.getTime()) / 60_000)} phút nữa`)
    }
    const to = Math.min(Math.round((cur * rule.multiplier) / 1000) * 1000, rule.max_budget)
    if (to <= cur) lyDo.push(`đã chạm trần ${vnd(rule.max_budget)}`)
    if (!lyDo.length) {
      const block = await accountBlocked(camp.ad_account_id)
      if (block) lyDo.push(block)
    }

    if (lyDo.length) { await note(camp.campaign_id, `Chưa tăng: ${lyDo.join("; ")}`, metrics); continue }

    const reason = `Hôm nay ${orders} đơn, ${vnd(cpa!)}/đơn, đã tiêu ${Math.round((spend / cur) * 100)}% ngân sách`
    if (await apply({ camp, rule, action: "tang", from: cur, to, reason, metrics, userModule })) actions++
    await note(camp.campaign_id, `${rule.dry_run ? "Lẽ ra đã tăng" : "Đã tăng"} ${vnd(cur)} → ${vnd(to)}: ${reason}`, metrics)
  }
  return { checked: camps.length, actions }
}
