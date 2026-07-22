// ============================================================================
// Sync cost ở level adset + ad, song song với campaign-level (mkt_ads_cost).
// Dùng chung cho cả 2 job: mkt-cost-daily-sync và mkt-cost-intraday-sync —
// logic upsert giống hệt nhau, chỉ khác ngày truyền vào.
// ============================================================================

import { extractMkt } from "./mkt-code"

const FB_API_BASE = "https://graph.facebook.com/v25.0"

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  return res.json()
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
    const data: any = await fetchJson(url)
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
  const fields = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks"
  let url: string | null = `${FB_API_BASE}/${actId}/insights?level=ad&fields=${fields}&time_range=${timeRange}&limit=500&access_token=${FB_TOKEN}`
  let synced = 0

  while (url) {
    const data: any = await fetchJson(url)
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
          (date, mkt_name, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, vd_code, spend, impressions, clicks)
        SELECT $1::date, u.mkt_name, $2, u.campaign_id, u.campaign_name, u.adset_id, u.adset_name, u.ad_id, u.ad_name, u.vd_code, u.spend, u.impressions, u.clicks
        FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::bigint[], $12::bigint[], $13::bigint[])
          AS u(mkt_name, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, vd_code, spend, impressions, clicks)
        ON CONFLICT (date, ad_id) DO UPDATE SET
          spend         = EXCLUDED.spend,
          impressions   = EXCLUDED.impressions,
          clicks        = EXCLUDED.clicks,
          mkt_name      = EXCLUDED.mkt_name,
          campaign_name = EXCLUDED.campaign_name,
          adset_name    = EXCLUDED.adset_name,
          ad_name       = EXCLUDED.ad_name,
          vd_code       = EXCLUDED.vd_code,
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
