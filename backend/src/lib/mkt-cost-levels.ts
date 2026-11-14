// ============================================================================
// Sync cost ở level adset + ad, song song với campaign-level (mkt_ads_cost).
// Dùng chung cho cả 2 job: mkt-cost-daily-sync và mkt-cost-intraday-sync —
// logic upsert giống hệt nhau, chỉ khác ngày truyền vào.
// ============================================================================

import { extractMkt } from "./mkt-code"
import { fbFetchJson } from "./fb-fetch"

const FB_API_BASE = "https://graph.facebook.com/v25.0"

// ---------------------------------------------------------------------------
// Chỉ số thêm (reach, link click, video 3s, thruplay, mua hàng FB) — xin chung request
// insights đang có, KHÔNG thêm lượt gọi FB. Ghi vào cột cùng tên trên mkt_ads_cost /
// mkt_ads_cost_ad (Migration20261114000000). FB không trả field → NULL (chưa đo, khác 0).
// ---------------------------------------------------------------------------
export const INSIGHT_EXTRA_FIELDS = "reach,frequency,inline_link_clicks,actions,action_values,video_thruplay_watched_actions"

// Các loại action "mua hàng" chồng lên nhau (omni ⊇ purchase ⊇ pixel) → lấy loại đầu tiên có, KHÔNG cộng.
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]

function actionOf(list: any, types: string[]): number | null {
  if (!Array.isArray(list)) return null
  for (const t of types) {
    const a = list.find((x: any) => x?.action_type === t)
    if (a) return Number(a.value ?? 0)
  }
  return null
}

const numOrNull = (v: any): number | null => {
  if (v === undefined || v === null || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const intOrNull = (v: number | null): number | null => (v === null ? null : Math.round(v))

export type InsightExtras = {
  reach: number | null
  frequency: number | null
  link_clicks: number | null
  video_3s: number | null
  thruplay: number | null
  fb_purchases: number | null
  fb_purchase_value: number | null
}

/**
 * Bóc chỉ số thêm từ 1 dòng insights (đã xin INSIGHT_EXTRA_FIELDS).
 * FB bỏ hẳn field mảng (actions...) khi dòng không có action loại đó → 0 nếu dòng có actions khác,
 * NULL nếu cả dòng không có actions (không phân biệt được "0" với "không xin").
 */
export function insightExtras(r: any): InsightExtras {
  const hasActions = Array.isArray(r?.actions)
  const fromList = (list: any, types: string[]) =>
    Array.isArray(list) ? intOrNull(actionOf(list, types)) ?? 0 : (hasActions ? 0 : null)
  return {
    reach: intOrNull(numOrNull(r?.reach)),
    frequency: numOrNull(r?.frequency),
    link_clicks: intOrNull(numOrNull(r?.inline_link_clicks)),
    video_3s: fromList(r?.actions, ["video_view"]),
    thruplay: fromList(r?.video_thruplay_watched_actions, ["video_view"]),
    fb_purchases: fromList(r?.actions, PURCHASE_TYPES),
    fb_purchase_value: fromList(r?.action_values, PURCHASE_TYPES),
  }
}

/** 7 mảng tham số cho cột chỉ số thêm, theo thứ tự reach, frequency, link_clicks, video_3s, thruplay, fb_purchases, fb_purchase_value. */
function extraArrays(rows: any[]): any[][] {
  const ex = rows.map(insightExtras)
  return [
    ex.map((e) => e.reach),
    ex.map((e) => e.frequency),
    ex.map((e) => e.link_clicks),
    ex.map((e) => e.video_3s),
    ex.map((e) => e.thruplay),
    ex.map((e) => e.fb_purchases),
    ex.map((e) => e.fb_purchase_value),
  ]
}

/**
 * Upsert 1 trang insights level=campaign vào mkt_ads_cost (kèm chỉ số thêm).
 * Dùng chung cho job intraday, job daily và POST /report/mkt-cost — trước đây 3 nơi tự viết câu INSERT.
 * Bỏ dòng spend=0 như cũ; dedupe theo campaign_id (ON CONFLICT không cho trùng trong cùng câu).
 * Trả về các dòng đã ghi.
 */
export async function upsertCampaignCostRows(
  cskhService: any,
  date: string,
  actId: string,
  data: any[]
): Promise<any[]> {
  const byId = new Map<string, any>()
  for (const c of data ?? []) {
    if (Math.round(Number(c.spend ?? 0)) > 0 && c.campaign_id) byId.set(String(c.campaign_id), c)
  }
  const rows = [...byId.values()]
  if (!rows.length) return rows
  await cskhService.sql(`
    INSERT INTO mkt_ads_cost (date, mkt_name, ad_account_id, campaign_id, campaign_name, spend, impressions, clicks,
      reach, frequency, link_clicks, video_3s, thruplay, fb_purchases, fb_purchase_value)
    SELECT $1::date, u.mkt_name, $2, u.campaign_id, u.campaign_name, u.spend, u.impressions, u.clicks,
      u.reach, u.frequency, u.link_clicks, u.video_3s, u.thruplay, u.fb_purchases, u.fb_purchase_value
    FROM unnest($3::text[], $4::text[], $5::text[], $6::bigint[], $7::bigint[], $8::bigint[],
                $9::bigint[], $10::numeric[], $11::bigint[], $12::bigint[], $13::bigint[], $14::int[], $15::bigint[])
      AS u(mkt_name, campaign_id, campaign_name, spend, impressions, clicks,
           reach, frequency, link_clicks, video_3s, thruplay, fb_purchases, fb_purchase_value)
    ON CONFLICT (date, campaign_id) DO UPDATE SET
      spend = EXCLUDED.spend,
      impressions = EXCLUDED.impressions,
      clicks = EXCLUDED.clicks,
      mkt_name = EXCLUDED.mkt_name,
      reach = COALESCE(EXCLUDED.reach, mkt_ads_cost.reach),
      frequency = COALESCE(EXCLUDED.frequency, mkt_ads_cost.frequency),
      link_clicks = COALESCE(EXCLUDED.link_clicks, mkt_ads_cost.link_clicks),
      video_3s = COALESCE(EXCLUDED.video_3s, mkt_ads_cost.video_3s),
      thruplay = COALESCE(EXCLUDED.thruplay, mkt_ads_cost.thruplay),
      fb_purchases = COALESCE(EXCLUDED.fb_purchases, mkt_ads_cost.fb_purchases),
      fb_purchase_value = COALESCE(EXCLUDED.fb_purchase_value, mkt_ads_cost.fb_purchase_value),
      updated_at = now()
  `, [
    date, actId,
    rows.map((c) => extractMkt(c.campaign_name ?? "")),
    rows.map((c) => String(c.campaign_id)),
    rows.map((c) => c.campaign_name ?? ""),
    rows.map((c) => Math.round(Number(c.spend ?? 0))),
    rows.map((c) => Number(c.impressions ?? 0)),
    rows.map((c) => Number(c.clicks ?? 0)),
    ...extraArrays(rows),
  ])
  return rows
}

/** URL insights level=campaign cho 1 tài khoản + 1 ngày (kèm chỉ số thêm). */
export function campaignInsightsUrl(actId: string, date: string, token: string): string {
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))
  return `${FB_API_BASE}/${actId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,${INSIGHT_EXTRA_FIELDS}&time_range=${timeRange}&limit=200&access_token=${token}`
}

/** Extract VD code từ ad_name (KIENLB_PHVVN026CV_REAL_VD1412 → VD1412) */
export function extractVdCode(adName: string): string | null {
  return String(adName ?? "").match(/VD\d+/i)?.[0]?.toUpperCase() ?? null
}

/**
 * Sync level=adset cho 1 account + 1 ngày.
 * mkt_name lấy từ campaign_name (không phải adset_name) — tên adset không chứa MKT code.
 */
async function syncAdsetLevel(
  cskhService: any,
  logger: any,
  FB_TOKEN: string,
  date: string,
  actId: string
): Promise<number> {
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))
  const fields = "campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks"
  let url: string | null = `${FB_API_BASE}/${actId}/insights?level=adset&fields=${fields}&time_range=${timeRange}&limit=300&access_token=${FB_TOKEN}`
  let synced = 0

  while (url) {
    const data: any = await fbFetchJson(url)
    if (data.error) {
      logger?.error?.(`[MktCostAdset] FB API error ${actId} date=${date}: ${data.error.message}`)
      break
    }

    // Dedupe theo adset_id — ON CONFLICT không cho trùng key trong cùng 1 câu INSERT
    const byId = new Map<string, any>()
    for (const r of (data.data ?? [])) {
      if (r.adset_id && Math.round(Number(r.spend ?? 0)) > 0) byId.set(String(r.adset_id), r)
    }
    const rows = [...byId.values()]

    if (rows.length > 0) {
      await cskhService.sql(`
        INSERT INTO mkt_ads_cost_adset
          (date, mkt_name, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, spend, impressions, clicks)
        SELECT $1::date, u.mkt_name, $2, u.campaign_id, u.campaign_name, u.adset_id, u.adset_name, u.spend, u.impressions, u.clicks
        FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::bigint[], $9::bigint[], $10::bigint[])
          AS u(mkt_name, campaign_id, campaign_name, adset_id, adset_name, spend, impressions, clicks)
        ON CONFLICT (date, adset_id) DO UPDATE SET
          spend         = EXCLUDED.spend,
          impressions   = EXCLUDED.impressions,
          clicks        = EXCLUDED.clicks,
          mkt_name      = EXCLUDED.mkt_name,
          campaign_name = EXCLUDED.campaign_name,
          adset_name    = EXCLUDED.adset_name,
          updated_at    = now()
      `, [
        date, actId,
        rows.map((r) => extractMkt(r.campaign_name ?? "")),
        rows.map((r) => String(r.campaign_id ?? "")),
        rows.map((r) => r.campaign_name ?? ""),
        rows.map((r) => String(r.adset_id)),
        rows.map((r) => r.adset_name ?? ""),
        rows.map((r) => Math.round(Number(r.spend ?? 0))),
        rows.map((r) => Number(r.impressions ?? 0)),
        rows.map((r) => Number(r.clicks ?? 0)),
      ])
      synced += rows.length
    }

    url = data.paging?.next ?? null
  }

  return synced
}

/**
 * Sync level=ad cho 1 account + 1 ngày.
 * vd_code extract sẵn khi ghi để report không phải regex lúc query.
 */
async function syncAdLevel(
  cskhService: any,
  logger: any,
  FB_TOKEN: string,
  date: string,
  actId: string
): Promise<number> {
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))
  const fields = `campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,${INSIGHT_EXTRA_FIELDS}`
  // limit 250 (trước 500): mỗi dòng giờ kèm mảng actions → trang nhỏ hơn, tránh lỗi FB "reduce the amount of data".
  // ~75 ad có chi/ngày cả hệ thống → vẫn 1 trang/tài khoản = không thêm request.
  let url: string | null = `${FB_API_BASE}/${actId}/insights?level=ad&fields=${fields}&time_range=${timeRange}&limit=250&access_token=${FB_TOKEN}`
  let synced = 0

  while (url) {
    const data: any = await fbFetchJson(url)
    if (data.error) {
      logger?.error?.(`[MktCostAd] FB API error ${actId} date=${date}: ${data.error.message}`)
      break
    }

    const byId = new Map<string, any>()
    for (const r of (data.data ?? [])) {
      if (r.ad_id && Math.round(Number(r.spend ?? 0)) > 0) byId.set(String(r.ad_id), r)
    }
    const rows = [...byId.values()]

    if (rows.length > 0) {
      await cskhService.sql(`
        INSERT INTO mkt_ads_cost_ad
          (date, mkt_name, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, vd_code, spend, impressions, clicks,
           reach, frequency, link_clicks, video_3s, thruplay, fb_purchases, fb_purchase_value)
        SELECT $1::date, u.mkt_name, $2, u.campaign_id, u.campaign_name, u.adset_id, u.adset_name, u.ad_id, u.ad_name, u.vd_code, u.spend, u.impressions, u.clicks,
           u.reach, u.frequency, u.link_clicks, u.video_3s, u.thruplay, u.fb_purchases, u.fb_purchase_value
        FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::bigint[], $12::bigint[], $13::bigint[],
                    $14::bigint[], $15::numeric[], $16::bigint[], $17::bigint[], $18::bigint[], $19::int[], $20::bigint[])
          AS u(mkt_name, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, vd_code, spend, impressions, clicks,
               reach, frequency, link_clicks, video_3s, thruplay, fb_purchases, fb_purchase_value)
        ON CONFLICT (date, ad_id) DO UPDATE SET
          spend         = EXCLUDED.spend,
          impressions   = EXCLUDED.impressions,
          clicks        = EXCLUDED.clicks,
          mkt_name      = EXCLUDED.mkt_name,
          campaign_name = EXCLUDED.campaign_name,
          adset_name    = EXCLUDED.adset_name,
          ad_name       = EXCLUDED.ad_name,
          vd_code       = EXCLUDED.vd_code,
          reach             = COALESCE(EXCLUDED.reach, mkt_ads_cost_ad.reach),
          frequency         = COALESCE(EXCLUDED.frequency, mkt_ads_cost_ad.frequency),
          link_clicks       = COALESCE(EXCLUDED.link_clicks, mkt_ads_cost_ad.link_clicks),
          video_3s          = COALESCE(EXCLUDED.video_3s, mkt_ads_cost_ad.video_3s),
          thruplay          = COALESCE(EXCLUDED.thruplay, mkt_ads_cost_ad.thruplay),
          fb_purchases      = COALESCE(EXCLUDED.fb_purchases, mkt_ads_cost_ad.fb_purchases),
          fb_purchase_value = COALESCE(EXCLUDED.fb_purchase_value, mkt_ads_cost_ad.fb_purchase_value),
          updated_at    = now()
      `, [
        date, actId,
        rows.map((r) => extractMkt(r.campaign_name ?? "")),
        rows.map((r) => String(r.campaign_id ?? "")),
        rows.map((r) => r.campaign_name ?? ""),
        rows.map((r) => String(r.adset_id ?? "")),
        rows.map((r) => r.adset_name ?? ""),
        rows.map((r) => String(r.ad_id)),
        rows.map((r) => r.ad_name ?? ""),
        rows.map((r) => extractVdCode(r.ad_name ?? "")),
        rows.map((r) => Math.round(Number(r.spend ?? 0))),
        rows.map((r) => Number(r.impressions ?? 0)),
        rows.map((r) => Number(r.clicks ?? 0)),
        ...extraArrays(rows),
      ])
      synced += rows.length
    }

    url = data.paging?.next ?? null
  }

  return synced
}

/**
 * Sync cả adset + ad level cho 1 account + 1 ngày.
 * Chạy song song 2 level vì độc lập nhau (khác bảng, khác request FB).
 * Lỗi 1 level không làm hỏng level kia — mỗi level tự log và trả 0.
 */
export async function syncAdsetAndAdLevels(
  cskhService: any,
  logger: any,
  FB_TOKEN: string,
  date: string,
  rawAccount: string
): Promise<{ adsets: number; ads: number; errors: number }> {
  const actId = rawAccount.startsWith("act_") ? rawAccount : `act_${rawAccount}`

  const [adsetRes, adRes] = await Promise.allSettled([
    syncAdsetLevel(cskhService, logger, FB_TOKEN, date, actId),
    syncAdLevel(cskhService, logger, FB_TOKEN, date, actId),
  ])

  let errors = 0
  let adsets = 0
  let ads = 0

  if (adsetRes.status === "fulfilled") adsets = adsetRes.value
  else { errors++; logger?.error?.(`[MktCostAdset] ${actId} date=${date}: ${adsetRes.reason?.message}`) }

  if (adRes.status === "fulfilled") ads = adRes.value
  else { errors++; logger?.error?.(`[MktCostAd] ${actId} date=${date}: ${adRes.reason?.message}`) }

  return { adsets, ads, errors }
}
