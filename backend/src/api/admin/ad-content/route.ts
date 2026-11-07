import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../lib/db"
import { AdPreview, parseAdPreviewHtml } from "../../../lib/fb-ad-preview"
import { extractMkt } from "../../../lib/mkt-code"
import { MKT_ORDER_FILTER_SQL } from "../../../lib/mkt-today"
import { callFbApi } from "../pancake-sync/report/camp-control/_lib"

/**
 * GET /admin/ad-content[?refresh=1] — ad đang chạy (effective_status = ACTIVE) kèm thứ khách nhìn thấy.
 * Trạng thái ad không lưu trong DB (mkt_ads_cost_ad.effective_status luôn null) nên phải đọc FB.
 * Tiêu đề lấy từ bản xem trước vì ad dùng bài có sẵn không trả tiêu đề qua creative.
 * Chỉ đọc. Danh sách cache 5 phút, bản xem trước cache theo ad (mỗi lần tải ~700KB).
 */

const AD_FIELDS =
  "id,name,effective_status,created_time,preview_shareable_link,campaign{id,name,daily_budget},adset{id,name,daily_budget}," +
  "creative{id,title,body,object_type,call_to_action_type,thumbnail_url,effective_object_story_id,link_url," +
  "object_story_spec{page_id,video_data{title,message,link_description,call_to_action},link_data{name,message,description,link}}," +
  "asset_feed_spec{titles,bodies,descriptions,link_urls}}"
const LIST_CACHE_MS = 5 * 60 * 1000
const PREVIEW_CACHE_MS = 3 * 60 * 60 * 1000
const PREVIEW_REFRESH_MS = 30 * 60 * 1000
const FB_CONCURRENCY = 6
const HIDDEN_CHARS = /[​-‏⁠﻿]/g
// preview_iframe.php trả lỗi 400 nếu request không giống trình duyệt mở trang
const PREVIEW_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  Accept: "text/html",
  "Accept-Language": "vi-VN,vi;q=0.9",
}

const uniq = (a: (string | null | undefined)[]) => [...new Set(a.map((s) => (s || "").trim()).filter(Boolean))]
const normUtm = (s: string | null) => (s || "").replace(HIDDEN_CHARS, "").trim()
const shortAccount = (name: string, id: string) => {
  const m = name.match(/ads\s*-?\s*(\d+)/i)
  return m ? `ADS${m[1]}` : name || id
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

async function fetchActiveAds(accountId: string): Promise<any[]> {
  const filtering = encodeURIComponent(JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]))
  const ads: any[] = []
  let after = ""
  for (let page = 0; page < 20; page++) {
    const path = `/${accountId}/ads?fields=${encodeURIComponent(AD_FIELDS)}&filtering=${filtering}&limit=100${after ? `&after=${after}` : ""}`
    const r = await callFbApi("GET", path)
    if (!r.ok) throw new Error(String(r.data?.error?.message || `FB ${r.status}`).slice(0, 160))
    ads.push(...(r.data.data || []))
    after = r.data.paging?.next ? r.data.paging?.cursors?.after || "" : ""
    if (!after) break
  }
  return ads
}

const previewCache = new Map<string, { at: number; preview: AdPreview }>()

async function fetchPreview(adId: string, maxAge: number): Promise<AdPreview | null> {
  const hit = previewCache.get(adId)
  if (hit && Date.now() - hit.at < maxAge) return hit.preview
  try {
    const r = await callFbApi("GET", `/${adId}/previews?ad_format=MOBILE_FEED_STANDARD`)
    const src = String(r.data?.data?.[0]?.body || "").match(/src="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&")
    if (!src) return hit?.preview ?? null
    const html = await (await fetch(src, { headers: PREVIEW_HEADERS, signal: AbortSignal.timeout(30000) })).text()
    const preview = parseAdPreviewHtml(html)
    if (!preview) return hit?.preview ?? null
    previewCache.set(adId, { at: Date.now(), preview })
    return preview
  } catch {
    return hit?.preview ?? null
  }
}

async function loadProducts(): Promise<{ code: string; name: string }[]> {
  const { rows } = await getPool().query(`SELECT code, name FROM mkt_product WHERE active AND code IS NOT NULL AND code <> ''`)
  return rows
    .map((r: any) => ({ code: String(r.code).toUpperCase(), name: String(r.name) }))
    .sort((a: any, b: any) => b.code.length - a.code.length)
}

/** Mã SP lấy từ tên camp rồi tới tên ad; mkt_product là nguồn tên SP, không có thì lấy đoạn tên trong tên camp. */
function resolveProduct(campName: string, adName: string, mkt: string, products: { code: string; name: string }[]) {
  for (const src of [campName, adName]) {
    const up = src.toUpperCase()
    const hit = products.find((p) => up.includes(p.code))
    if (hit) return { code: hit.code, name: hit.name }
  }
  const code = (campName + " " + adName).toUpperCase().match(/PHVVN\d+[A-Z0-9]*/)?.[0] ?? null
  const parts = campName.split("_").map((s) => s.trim())
  const i = parts.findIndex((p) => p.toUpperCase() === mkt)
  return { code, name: (i >= 0 && parts[i + 1]) || code || "Chưa rõ" }
}

async function buildData(refresh: boolean) {
  const pool = getPool()
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const { rows: accRows } = await pool.query(
    `SELECT account_id FROM fb_ad_account WHERE active AND deleted_at IS NULL
     UNION
     SELECT DISTINCT ad_account_id FROM mkt_ads_cost
      WHERE deleted_at IS NULL AND ad_account_id IS NOT NULL AND spend > 0 AND date >= $1::date - 3`,
    [today]
  )
  const { rows: nameRows } = await pool.query(`SELECT account_id, account_name FROM fb_ad_account WHERE deleted_at IS NULL`)
  const accName = new Map<string, string>(nameRows.map((r: any) => [r.account_id, r.account_name || ""]))
  const accounts: string[] = accRows.map((r: any) => String(r.account_id))

  const errors: { account: string; error: string }[] = []
  const lists = await mapLimit(accounts, FB_CONCURRENCY, async (id) => {
    try {
      return (await fetchActiveAds(id)).map((ad) => ({ ...ad, account_id: id }))
    } catch (e: any) {
      errors.push({ account: shortAccount(accName.get(id) || "", id), error: e.message })
      return []
    }
  })
  const ads = lists.flat()

  const adIds = ads.map((a) => String(a.id))
  const maxAge = refresh ? PREVIEW_REFRESH_MS : PREVIEW_CACHE_MS
  const previews = new Map<string, AdPreview | null>()
  await mapLimit(adIds, FB_CONCURRENCY, async (id) => { previews.set(id, await fetchPreview(id, maxAge)) })

  const { rows: costRows } = await pool.query(
    `SELECT ad_id, (ARRAY_AGG(mkt_name ORDER BY date DESC))[1] mkt_name, (ARRAY_AGG(vd_code ORDER BY date DESC))[1] vd_code,
            COALESCE(SUM(spend) FILTER (WHERE date::date = $2::date), 0)::bigint spend_today,
            SUM(spend)::bigint spend_7d, SUM(impressions)::bigint impressions_7d, SUM(clicks)::bigint clicks_7d
       FROM mkt_ads_cost_ad
      WHERE deleted_at IS NULL AND ad_id = ANY($1::text[]) AND date >= $2::date - 6
      GROUP BY ad_id`,
    [adIds, today]
  )
  const cost = new Map<string, any>(costRows.map((r: any) => [String(r.ad_id), r]))

  // Đơn 7 ngày ghép theo UTM: ad id trong utm_content, hoặc (camp, tên ad). Không phải đơn nào cũng ghép được → số này là mức tối thiểu.
  const { rows: orderRows } = await pool.query(
    `SELECT raw->>'p_utm_source' so, raw->>'p_utm_campaign' c, raw->>'p_utm_content' ct,
            count(*) FILTER (WHERE status NOT IN (-2, 7))::int o
       FROM pancake_order
      WHERE ${MKT_ORDER_FILTER_SQL}
        AND raw->>'p_utm_content' IS NOT NULL
        AND pancake_created_at >= (($1::date - 6)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      GROUP BY 1, 2, 3`,
    [today]
  )
  const byKey = new Map<string, any>()
  for (const ad of ads) {
    const n = normUtm(ad.name)
    byKey.set(`${ad.campaign?.id}|${n}`, ad)
    byKey.set(`${normUtm(ad.campaign?.name)}|${n}`, ad)
  }
  const byId = new Map<string, any>(ads.map((a) => [String(a.id), a]))
  const orders = new Map<string, number>()
  for (const o of orderRows) {
    const ct = normUtm(o.ct)
    const ad = byId.get(ct) || byKey.get(`${normUtm(o.c)}|${ct}`) || byKey.get(`${normUtm(o.so)}|${ct}`)
    if (ad) orders.set(String(ad.id), (orders.get(String(ad.id)) || 0) + Number(o.o || 0))
  }

  const products = await loadProducts()
  const rows = ads.map((ad) => {
    const c = ad.creative || {}
    const spec = c.object_story_spec || {}
    const feed = c.asset_feed_spec || {}
    const preview = previews.get(String(ad.id)) ?? null
    const card = preview?.cards[0]
    const story: string | null = c.effective_object_story_id || null
    const pageId: string | null = spec.page_id || story?.split("_")[0] || null
    const apiDescriptions = uniq([spec.video_data?.link_description, spec.link_data?.description, ...(feed.descriptions || []).map((t: any) => t.text)])
    const apiTitles = uniq([c.title, spec.video_data?.title, spec.link_data?.name, ...(feed.titles || []).map((t: any) => t.text)])
    // Tiêu đề khách thấy là chuẩn. Không có bản xem trước thì lấy creative; thiếu title thì FB hiện mô tả vào chỗ tiêu đề.
    const titles = uniq([...(preview?.cards || []).map((x) => x.headline), ...apiTitles])
    if (!titles.length && apiDescriptions[0]) titles.push(apiDescriptions[0])
    const m = cost.get(String(ad.id))
    const campName = String(ad.campaign?.name || "")
    const mkt = m?.mkt_name || extractMkt(campName)
    const product = resolveProduct(campName, String(ad.name || ""), mkt, products)
    const impressions = Number(m?.impressions_7d || 0)
    const clicks = Number(m?.clicks_7d || 0)
    const spend7 = Number(m?.spend_7d || 0)
    return {
      ad_id: String(ad.id),
      ad_name: ad.name,
      vd_code: m?.vd_code || String(ad.name || "").match(/VD\d+/i)?.[0]?.toUpperCase() || null,
      created_time: ad.created_time,
      preview_url: ad.preview_shareable_link || null,
      ads_manager_url: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${ad.account_id.replace(/^act_/, "")}&selected_ad_ids=${ad.id}`,
      campaign_id: ad.campaign?.id,
      campaign_name: campName,
      campaign_budget: ad.campaign?.daily_budget ? Number(ad.campaign.daily_budget) : null,
      adset_id: ad.adset?.id,
      adset_name: ad.adset?.name,
      adset_budget: ad.adset?.daily_budget ? Number(ad.adset.daily_budget) : null,
      account_id: ad.account_id,
      account_name: shortAccount(accName.get(ad.account_id) || "", ad.account_id),
      mkt,
      product_code: product.code,
      product_name: product.name,
      page_id: pageId,
      page_name: preview?.page_name ?? null,
      post_id: story,
      post_url: story ? `https://www.facebook.com/${story}` : null,
      creative_id: c.id || null,
      titles,
      descriptions: uniq([card?.description, ...apiDescriptions]).filter((d) => !titles.includes(d)),
      bodies: uniq([preview?.message, c.body, spec.video_data?.message, spec.link_data?.message, ...(feed.bodies || []).map((t: any) => t.text)]),
      cta: card?.cta || c.call_to_action_type || null,
      landing: c.link_url || spec.video_data?.call_to_action?.value?.link || spec.link_data?.link || feed.link_urls?.[0]?.website_url || card?.link || null,
      thumbnail: c.thumbnail_url || null,
      preview,
      spend_today: Number(m?.spend_today || 0),
      spend_7d: spend7,
      ctr_7d: impressions > 0 ? (clicks / impressions) * 100 : null,
      cpm_7d: impressions > 0 ? (spend7 / impressions) * 1000 : null,
      orders_7d: orders.get(String(ad.id)) || 0,
    }
  })
  return { generated_at: new Date().toISOString(), accounts_checked: accounts.length, errors, rows }
}

let cache: { at: number; data: Promise<any> } | null = null

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const refresh = (req.query as any).refresh === "1"
    if (refresh || !cache || Date.now() - cache.at > LIST_CACHE_MS) {
      cache = { at: Date.now(), data: buildData(refresh) }
      cache.data.catch(() => { cache = null })
    }
    return res.json(await cache.data)
  } catch (err: any) {
    console.error("[ad-content]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
