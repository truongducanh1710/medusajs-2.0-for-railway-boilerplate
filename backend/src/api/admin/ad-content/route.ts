import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../lib/db"
import { extractMkt } from "../../../lib/mkt-code"
import { MKT_ORDER_FILTER_SQL } from "../../../lib/mkt-today"
import { callFbApi, FB_API_BASE } from "../pancake-sync/report/camp-control/_lib"

/**
 * GET /admin/ad-content[?refresh=1] — ad đang chạy (effective_status = ACTIVE) kèm nội dung creative.
 * Trạng thái ad không lưu trong DB (mkt_ads_cost_ad.effective_status luôn null) nên phải đọc FB.
 * Chỉ đọc. Cache 5 phút để không ăn rate limit FB khi nhiều người mở tab.
 */

const AD_FIELDS =
  "id,name,effective_status,created_time,preview_shareable_link,campaign{id,name,daily_budget},adset{id,name,daily_budget}," +
  "creative{id,title,body,object_type,call_to_action_type,thumbnail_url,effective_object_story_id,link_url," +
  "object_story_spec{page_id,video_data{title,message,link_description,call_to_action},link_data{name,message,description,link}}," +
  "asset_feed_spec{titles,bodies,descriptions,link_urls}}"
const CACHE_MS = 5 * 60 * 1000
const FB_CONCURRENCY = 6
const HIDDEN_CHARS = /[​-‏⁠﻿]/g

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

/** Tên page + nội dung bài gốc. Bài đăng cần page token — token chỉ dùng trong hàm này, không trả ra ngoài. */
async function fetchPageInfo(pageIds: string[], storyIds: string[]) {
  const pages = new Map<string, { name: string | null; token: string | null }>()
  await mapLimit(pageIds, FB_CONCURRENCY, async (id) => {
    const r = await callFbApi("GET", `/${id}?fields=name,access_token`)
    if (r.ok) return pages.set(id, { name: r.data.name ?? null, token: r.data.access_token ?? null })
    const n = await callFbApi("GET", `/${id}?fields=name`)
    return pages.set(id, { name: n.ok ? n.data.name ?? null : null, token: null })
  })
  const posts = new Map<string, any>()
  await mapLimit(storyIds, FB_CONCURRENCY, async (story) => {
    const token = pages.get(story.split("_")[0])?.token
    if (!token) return
    try {
      const url = `${FB_API_BASE}/${story}?fields=${encodeURIComponent("message,call_to_action,attachments{title,description}")}&access_token=${token}`
      const j: any = await (await fetch(url)).json()
      if (!j.error) posts.set(story, j)
    } catch { /* bài không đọc được: giữ nội dung từ creative */ }
  })
  return { pages, posts }
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

async function buildData() {
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

  const storyOf = (ad: any): string | null => ad.creative?.effective_object_story_id || null
  const pageOf = (ad: any): string | null => ad.creative?.object_story_spec?.page_id || storyOf(ad)?.split("_")[0] || null
  const pageIds = uniq(ads.map(pageOf))
  const storyIds = uniq(ads.map(storyOf))
  const { pages, posts } = await fetchPageInfo(pageIds, storyIds)

  const adIds = ads.map((a) => String(a.id))
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
    const story = storyOf(ad)
    const post = story ? posts.get(story) : null
    const att = post?.attachments?.data?.[0]
    const pageId = pageOf(ad)
    const creativeTitles = uniq([c.title, spec.video_data?.title, spec.link_data?.name, ...(feed.titles || []).map((t: any) => t.text)])
    const titles = creativeTitles.length ? creativeTitles : uniq([att?.title])
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
      page_name: pageId ? pages.get(pageId)?.name ?? null : null,
      post_id: story,
      post_url: story ? `https://www.facebook.com/${story}` : null,
      creative_id: c.id || null,
      titles,
      descriptions: uniq([spec.video_data?.link_description, spec.link_data?.description, ...(feed.descriptions || []).map((t: any) => t.text), att?.description]),
      bodies: uniq([c.body, spec.video_data?.message, spec.link_data?.message, ...(feed.bodies || []).map((t: any) => t.text), post?.message]),
      cta: c.call_to_action_type || post?.call_to_action?.type || null,
      landing: c.link_url || spec.video_data?.call_to_action?.value?.link || spec.link_data?.link || feed.link_urls?.[0]?.website_url || post?.call_to_action?.value?.link || null,
      thumbnail: c.thumbnail_url || null,
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
    if (refresh || !cache || Date.now() - cache.at > CACHE_MS) {
      cache = { at: Date.now(), data: buildData() }
      cache.data.catch(() => { cache = null })
    }
    return res.json(await cache.data)
  } catch (err: any) {
    console.error("[ad-content]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
