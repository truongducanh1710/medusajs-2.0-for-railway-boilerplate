import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, ensureTables, callFb, getFbAdInfo, createUnpublishedPost, getPageTokens, uploadVideoToFbFromDrive, waitForFbVideoReady } from "../_lib"

// ── Naming helpers (mirror src/admin/lib/camp-naming.ts) ────────────────────
const UTM_STATIC =
  "utm_source={{campaign.name}}&utm_medium={{adset.name}}&utm_campaign={{campaign.id}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}"

const todayDM = (d = new Date()) => `${d.getDate()}/${d.getMonth() + 1}`
const buildAdName = (vd: string, postId: string) => `${vd} - ${postId}`

// ── Chuẩn cấu hình adset ─────────────────────────────────────────────────────
// Đối chiếu camp mẫu "24/05_XUANLT_CHẢO VÀNG HẤP_ADS341_VD111112113V_30ALL"
// (adset 120246449308750614) — verified trực tiếp trên Graph API 15/8/2026.

/**
 * Cửa sổ quy đổi. KHÔNG gửi field này thì FB mặc định chỉ 7d click → hụt
 * view-through + engaged video view so với camp mẫu (đã đo thực tế).
 * Lưu ý: destination_type KHÔNG ảnh hưởng tới attribution (đã test WEBSITE + 3 cửa sổ, FB nhận đủ).
 */
const ATTRIBUTION_STD = [
  { event_type: "CLICK_THROUGH", window_days: 7 },
  { event_type: "VIEW_THROUGH", window_days: 1 },
  { event_type: "ENGAGED_VIDEO_VIEW", window_days: 1 },
]

const MIN_DAILY_BUDGET = 50_000
const DEFAULT_DAILY_BUDGET = 500_000

/** Ngân sách/ngày: mặc định 500k, sàn cứng 50k cho MỌI mode (trước đây chỉ mode B check). */
function resolveDailyBudget(b: any): number {
  const v = Number(b.daily_budget) || DEFAULT_DAILY_BUDGET
  if (v < MIN_DAILY_BUDGET) throw new Error(`Ngân sách tối thiểu ${MIN_DAILY_BUDGET.toLocaleString("vi-VN")}đ`)
  return v
}

/**
 * Targeting chuẩn theo camp mẫu.
 *
 * age_min PHẢI ≤ 25 khi advantage_audience=1 — gửi cao hơn thì FB từ chối tạo adset:
 *   #100 subcode 1870188 "Với nhóm quảng cáo dùng đối tượng Advantage+, bạn không thể
 *   đặt lựa chọn kiểm soát đối tượng theo độ tuổi tối thiểu cao hơn 25".
 * Muốn nhắm già hơn thì để tuổi mong muốn vào age_range (FB coi là gợi ý) — đúng cách
 * camp mẫu làm: age_min 25 + age_range [30, 65].
 *
 * KHÔNG gửi destination_type (mẫu để UNDEFINED) và KHÔNG gửi locales (mẫu không giới hạn
 * tiếng Việt — gửi [27] là tự thu hẹp tệp).
 */
function buildTargeting(b: any) {
  const wanted = Number(b.age_min) || 25
  const t: any = {
    geo_locations: { countries: ["VN"], location_types: ["home", "recent"] },
    age_min: 25,
    age_max: 65,
    brand_safety_content_filter_levels: ["FACEBOOK_RELAXED", "AN_RELAXED"],
    targeting_automation: { advantage_audience: 1 },
  }
  if (wanted > 25) t.age_range = [wanted, 65]
  if (Array.isArray(b.excluded_audience_ids) && b.excluded_audience_ids.length > 0) {
    t.excluded_custom_audiences = b.excluded_audience_ids.map((id: string) => ({ id }))
  }
  return t
}

// ── Mode E (dark_post_raw_video) — hỗ trợ NHIỀU video trong 1 camp ─────────
// 1 campaign → 1 adset → N ad (mỗi video 1 ad), đúng cấu trúc camp mẫu
// (adset "VD111112113V" chứa 3 ad VD111/VD112/VD113V).

type VideoItem = {
  vd_code: string
  drive_url?: string
  video_id?: string
  thumbnail_url?: string | null
  message?: string
  cta_type?: string
  link?: string
  title?: string
}

/** Gộp nhiều mã VD giống cách đặt tên adset của camp mẫu: VD111 + VD112 + VD113V → "VD111112113V". */
function joinVdCodes(vdCodes: string[]): string {
  if (vdCodes.length === 1) return vdCodes[0]
  const prefix = vdCodes[0].match(/^[A-Za-z]+/)?.[0] || "VD"
  const nums = vdCodes.map(v => v.replace(/^[A-Za-z]+/, ""))
  return prefix + nums.join("")
}

/** Upload (nếu cần) + poll ready cho 1 video. Ném lỗi nếu thất bại — caller gom vào errors[]. */
async function prepareVideo(adAcc: string, it: VideoItem): Promise<{ videoId: string; thumbnailUrl: string | null }> {
  if (it.video_id) {
    if (it.thumbnail_url) return { videoId: it.video_id, thumbnailUrl: it.thumbnail_url }
    const token = process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
    const thumbs: any = await fetch(`https://graph.facebook.com/v18.0/${it.video_id}/thumbnails?access_token=${token}`).then(r => r.json())
    const preferred = (thumbs?.data || []).find((t: any) => t.is_preferred) || thumbs?.data?.[0]
    return { videoId: it.video_id, thumbnailUrl: preferred?.uri || null }
  }
  const videoId = await uploadVideoToFbFromDrive(adAcc, it.drive_url!, it.vd_code)
  const pollResult = await waitForFbVideoReady(videoId)
  if (!pollResult.ready) throw new Error(`Video chưa xử lý xong sau khi chờ, thử lại sau (video_id: ${videoId})`)
  return { videoId, thumbnailUrl: pollResult.thumbnailUrl }
}

/** Tạo creative + ad cho từng video đã prepare, trong 1 adset. Lỗi từng video không chặn các video còn lại. */
async function createAdsForVideos(
  adAcc: string, b: any,
  prepared: { item: VideoItem; videoId: string; thumbnailUrl: string | null }[],
  adsetId: string,
  errors: { vd_code: string; error: string }[],
): Promise<{ vd_code: string; ad_id: string; creative_id: string; video_id: string }[]> {
  const results: { vd_code: string; ad_id: string; creative_id: string; video_id: string }[] = []
  for (const { item: it, videoId, thumbnailUrl } of prepared) {
    try {
      const videoData: Record<string, any> = {
        video_id: videoId,
        title: it.title || b.title || it.vd_code,
        message: it.message ?? b.message,
        call_to_action: {
          type: it.cta_type || b.cta_type || "SHOP_NOW",
          value: { link: it.link ?? b.link },
        },
      }
      if (thumbnailUrl) videoData.image_url = thumbnailUrl

      const creative = await callFb("POST", `/${adAcc}/adcreatives`, {
        name: `CR_${it.vd_code}`,
        object_story_spec: { page_id: b.page_id, video_data: videoData },
        url_tags: UTM_STATIC,
      })
      const ad = await callFb("POST", `/${adAcc}/ads`, {
        name: it.vd_code,
        adset_id: adsetId,
        creative: { creative_id: creative.id },
        status: "PAUSED",
      })
      results.push({ vd_code: it.vd_code, ad_id: ad.id, creative_id: creative.id, video_id: videoId })
    } catch (e: any) {
      errors.push({ vd_code: it.vd_code, error: e.message })
    }
  }
  return results
}

/**
 * GET /admin/fb-content/boost?ad_id=xxx
 * Preview thông tin ad nguồn (mode from_ad_id).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const adId = (req.query as any).ad_id
    if (!adId) return res.status(400).json({ error: "Thiếu ad_id" })
    const info = await getFbAdInfo(adId)
    return res.json(info)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/fb-content/boost
 * mode "existing_adset": thêm Ad vào adset có sẵn (2 API call)
 * mode "new_campaign":   tạo campaign mới đầy đủ (4 API call)
 * Tất cả tạo status PAUSED để review.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const b = req.body as any
    const mode: string = b.mode || "existing_adset"
    if (!b.ad_account_id) return res.status(400).json({ error: "Thiếu ad_account_id" })

    const pool = getPool()
    await ensureTables(pool)
    const adAcc: string = b.ad_account_id

    // ── MODE C: từ FB Ad ID cũ ────────────────────────────────────────────
    if (mode === "from_ad_id") {
      if (!b.source_ad_id) return res.status(400).json({ error: "Thiếu source_ad_id" })

      const adInfo = await getFbAdInfo(b.source_ad_id)
      const srcCreative = adInfo.creative
      if (!srcCreative?.id) return res.status(400).json({ error: "Không lấy được creative từ ad nguồn" })

      // Clone creative — ƯU TIÊN object_story_id (post đã đăng/dark post). Nếu creative
      // nguồn chỉ có video_id (không có object_story_id, vd creative dựng trực tiếp qua
      // object_story_spec.video_data như mode dark_post_raw_video), PHẢI dựng lại
      // object_story_spec — gửi object_story_id rỗng "" khiến FB trả lỗi generic
      // "An unknown error occurred" (code 1) không rõ nguyên nhân (bug thật đã gặp khi
      // test clone từ 1 ad có creative dạng video_id thuần).
      const creativeBody: Record<string, any> = {
        name: `${adInfo.ad_name} - clone`,
        url_tags: UTM_STATIC,
      }
      if (srcCreative.object_story_id) {
        creativeBody.object_story_id = srcCreative.object_story_id
      } else if (srcCreative.video_id) {
        if (!adInfo.adset?.promoted_object?.pixel_id && !b.pixel_id) {
          return res.status(400).json({ error: "Ad nguồn dùng creative dạng video_id không kèm post — cần b.pixel_id để dựng lại creative mới" })
        }
        creativeBody.object_story_spec = {
          page_id: adInfo.page_id,
          video_data: {
            video_id: srcCreative.video_id,
            title: adInfo.ad_name,
            message: srcCreative.body || adInfo.ad_name,
            call_to_action: { type: b.cta_type || "SHOP_NOW", value: { link: b.link || srcCreative.object_story_spec?.video_data?.call_to_action?.value?.link } },
          },
        }
      } else {
        return res.status(400).json({ error: "Creative nguồn không có object_story_id lẫn video_id — không rõ cách clone" })
      }
      const creative = await callFb("POST", `/${adAcc}/adcreatives`, creativeBody)

      // Nếu chọn adset có sẵn → thêm ad luôn
      if (b.adset_id) {
        const ad = await callFb("POST", `/${adAcc}/ads`, {
          name: b.ad_name || adInfo.ad_name,
          adset_id: b.adset_id,
          creative: { creative_id: creative.id },
          status: "PAUSED",
        })
        return res.json({
          mode, ad_id: ad.id, adset_id: b.adset_id, creative_id: creative.id,
          source_ad: { id: adInfo.ad_id, name: adInfo.ad_name, campaign: adInfo.campaign.name },
          adsmanager_url: `https://business.facebook.com/adsmanager/manage/ads?act=${adAcc.replace("act_", "")}`,
        })
      }

      // Nếu tạo camp mới từ ad cũ — dùng campaign_name client gửi hoặc tự sinh từ camp nguồn
      const campaignName: string = b.campaign_name?.trim() || `${adInfo.campaign.name} - clone ${todayDM()}`
      const campaign = await callFb("POST", `/${adAcc}/campaigns`, {
        name: campaignName,
        objective: adInfo.campaign.objective || "OUTCOME_SALES",
        status: "PAUSED",
        special_ad_categories: [],
        is_adset_budget_sharing_enabled: false,
        daily_budget: resolveDailyBudget(b), // CBO — budget ở cấp campaign, không phải adset (theo mẫu camp chạy tốt)
        bid_strategy: "LOWEST_COST_WITHOUT_CAP", // bắt buộc ở campaign khi CBO bật, thiếu → tạo adset lỗi "phải nhập giá thầu"
      })
      const targeting = buildTargeting(b)
      // pixel_id bắt buộc: optimization_goal=OFFSITE_CONVERSIONS mà promoted_object rỗng
      // → FB lỗi #100 subcode 2490408 "không thể dùng mục tiêu hiệu quả đã chọn cho mục
      // tiêu chiến dịch" (bug thật quan sát khi client gọi thiếu field này).
      if (!b.pixel_id) return res.status(400).json({ error: "Thiếu pixel_id — bắt buộc để tạo adset (optimization_goal=OFFSITE_CONVERSIONS)" })
      const promotedObject: any = {
        pixel_id: b.pixel_id,
        custom_event_type: b.custom_event_type || "COMPLETE_REGISTRATION",
        smart_pse_enabled: false,
      }
      const adset = await callFb("POST", `/${adAcc}/adsets`, {
        name: b.adset_name || adInfo.adset.name || "Ad Set",
        campaign_id: campaign.id,
        billing_event: "IMPRESSIONS",
        optimization_goal: "OFFSITE_CONVERSIONS",
        promoted_object: promotedObject,
        targeting,
        attribution_spec: ATTRIBUTION_STD,
        status: "PAUSED",
      })
      const ad = await callFb("POST", `/${adAcc}/ads`, {
        name: b.ad_name || adInfo.ad_name,
        adset_id: adset.id,
        creative: { creative_id: creative.id },
        status: "PAUSED",
      })
      return res.json({
        mode, campaign_id: campaign.id, campaign_name: campaignName,
        adset_id: adset.id, ad_id: ad.id, creative_id: creative.id,
        source_ad: { id: adInfo.ad_id, name: adInfo.ad_name },
        adsmanager_url: `https://business.facebook.com/adsmanager/manage/campaigns?act=${adAcc.replace("act_", "")}`,
      })
    }

    // ── MODE E: video raw từ Drive (Marketing Hub) → upload FB → dark post creative → camp ──
    // Không cần đăng Page trước. Nhận NHIỀU video → 1 camp / 1 adset / N ad,
    // đúng cấu trúc camp mẫu (adset VD111112113V chứa 3 ad, mỗi ad 1 video).
    if (mode === "dark_post_raw_video") {
      if (!b.page_id) return res.status(400).json({ error: "Thiếu page_id" })

      // Nhận mảng videos[]; client cũ (MCP) gửi field số ít thì bọc thành mảng 1 phần tử.
      const items: VideoItem[] = Array.isArray(b.videos) && b.videos.length > 0
        ? b.videos
        : [{
            vd_code: b.vd_code, drive_url: b.drive_url, video_id: b.video_id,
            thumbnail_url: b.thumbnail_url, message: b.message,
            cta_type: b.cta_type, link: b.link, title: b.title,
          }]

      if (items.length === 0) return res.status(400).json({ error: "Chưa chọn video nào" })
      for (const [i, it] of items.entries()) {
        if (!it.vd_code) return res.status(400).json({ error: `Video #${i + 1}: thiếu vd_code` })
        if (!it.video_id && !it.drive_url) return res.status(400).json({ error: `${it.vd_code}: cần drive_url hoặc video_id đã upload` })
        if (!(it.message ?? b.message)) return res.status(400).json({ error: `${it.vd_code}: thiếu message (caption)` })
        if (!(it.link ?? b.link)) return res.status(400).json({ error: `${it.vd_code}: thiếu link (CTA URL, không kèm UTM)` })
      }

      const pageTokens = await getPageTokens(pool)
      const pageToken = pageTokens.find(t => t.page_id === b.page_id)?.access_token
      if (!pageToken) return res.status(400).json({ error: "Không tìm thấy page token cho page này" })

      if (!b.pixel_id) return res.status(400).json({ error: "Thiếu pixel_id — bắt buộc để tạo adset (optimization_goal=OFFSITE_CONVERSIONS)" })

      let dailyBudget: number
      try { dailyBudget = resolveDailyBudget(b) } catch (e: any) { return res.status(400).json({ error: e.message }) }

      // 1. Upload + poll SONG SONG. Video lỗi không làm hỏng cả camp — gom vào errors[].
      const errors: { vd_code: string; error: string }[] = []
      const prepared = (await Promise.all(items.map(async it => {
        try {
          return { item: it, ...(await prepareVideo(adAcc, it)) }
        } catch (e: any) {
          errors.push({ vd_code: it.vd_code, error: e.message })
          return null
        }
      }))).filter(Boolean) as { item: VideoItem; videoId: string; thumbnailUrl: string | null }[]

      if (prepared.length === 0) {
        return res.status(400).json({ error: "Không video nào sẵn sàng để tạo quảng cáo", errors })
      }

      // Tên adset gộp mã VD như camp mẫu: VD111 + VD112 + VD113V → "VD111112113V"
      const vdCodes = prepared.map(p => p.item.vd_code)
      const adsetName: string = b.adset_name || joinVdCodes(vdCodes)

      // 2. Nếu chọn adset có sẵn → chỉ tạo creative + ad, bỏ qua campaign/adset
      if (b.adset_id) {
        const ads = await createAdsForVideos(adAcc, b, prepared, b.adset_id, errors)
        return res.json({
          mode, adset_id: b.adset_id, ads, errors,
          ad_id: ads[0]?.ad_id, creative_id: ads[0]?.creative_id, video_id: ads[0]?.video_id, // tương thích client cũ
          adsmanager_url: `https://business.facebook.com/adsmanager/manage/ads?act=${adAcc.replace("act_", "")}`,
        })
      }

      const campaignName: string = b.campaign_name?.trim() || (() => {
        const sku = (b.sku_code || "PHVVN").toUpperCase()
        const mkt = (auth.mktCode || "MKT").toUpperCase()
        const sp = (b.product_name || "SP").toUpperCase()
        const ads = b.ads_code || "ADS"
        const audience = (b.audience || "30ALL").trim()
        return `${sku}_${todayDM()}_${mkt}_${sp}_${ads}_${audience}_${adsetName}`
      })()

      // 3. Campaign (1) → Adset (1)
      const campaign = await callFb("POST", `/${adAcc}/campaigns`, {
        name: campaignName,
        objective: "OUTCOME_SALES",
        status: "PAUSED",
        special_ad_categories: [],
        is_adset_budget_sharing_enabled: false,
        daily_budget: dailyBudget, // CBO — budget ở cấp campaign
        bid_strategy: "LOWEST_COST_WITHOUT_CAP", // bắt buộc ở campaign khi CBO bật
      })
      const adset = await callFb("POST", `/${adAcc}/adsets`, {
        name: adsetName,
        campaign_id: campaign.id,
        billing_event: "IMPRESSIONS",
        optimization_goal: "OFFSITE_CONVERSIONS",
        promoted_object: {
          pixel_id: b.pixel_id,
          custom_event_type: b.custom_event_type || "COMPLETE_REGISTRATION",
          smart_pse_enabled: false,
        },
        targeting: buildTargeting(b),
        attribution_spec: ATTRIBUTION_STD,
        status: "PAUSED",
      })

      // 4. Mỗi video → 1 creative + 1 ad trong cùng adset
      const ads = await createAdsForVideos(adAcc, b, prepared, adset.id, errors)

      return res.json({
        mode, campaign_id: campaign.id, campaign_name: campaignName,
        adset_id: adset.id, adset_name: adsetName, ads, errors,
        ad_id: ads[0]?.ad_id, creative_id: ads[0]?.creative_id, video_id: ads[0]?.video_id, // tương thích client cũ
        adsmanager_url: `https://business.facebook.com/adsmanager/manage/campaigns?act=${adAcc.replace("act_", "")}`,
      })
    }

    // ── MODE D: video/ảnh chưa đăng → dark post → camp ───────────────────
    if (mode === "unpublished_post") {
      if (!b.page_id) return res.status(400).json({ error: "Thiếu page_id" })
      if (!b.message) return res.status(400).json({ error: "Thiếu message" })

      const pageTokens = await getPageTokens(pool)
      const pageToken = pageTokens.find(t => t.page_id === b.page_id)?.access_token
      if (!pageToken) return res.status(400).json({ error: "Không tìm thấy page token cho page này" })

      const { post_id, object_story_id } = await createUnpublishedPost({
        pageId: b.page_id,
        pageToken,
        message: b.message,
        videoId: b.video_id,
        imageUrl: b.image_url,
        link: b.link,
        name: b.link_name,
        description: b.link_description,
      })

      const vdCode: string = b.vd_code || "VD"
      const adName = buildAdName(vdCode, post_id)

      // Nếu vào adset có sẵn → chỉ tạo creative + ad
      if (b.adset_id) {
        const creative = await callFb("POST", `/${adAcc}/adcreatives`, {
          name: `${vdCode} creative`,
          object_story_id,
          url_tags: UTM_STATIC,
        })
        const ad = await callFb("POST", `/${adAcc}/ads`, {
          name: adName,
          adset_id: b.adset_id,
          creative: { creative_id: creative.id },
          status: "PAUSED",
        })
        return res.json({
          mode, ad_id: ad.id, adset_id: b.adset_id, creative_id: creative.id,
          dark_post_id: post_id, object_story_id,
          adsmanager_url: `https://business.facebook.com/adsmanager/manage/ads?act=${adAcc.replace("act_", "")}`,
        })
      }

      // Tạo camp mới hoàn chỉnh
      let dailyBudget: number
      try { dailyBudget = resolveDailyBudget(b) } catch (e: any) { return res.status(400).json({ error: e.message }) }
      const campaignName: string = b.campaign_name?.trim() || (() => {
        const sku = (b.sku_code || "PHVVN").toUpperCase()
        const mkt = (auth.mktCode || "MKT").toUpperCase()
        const sp = (b.product_name || "SP").toUpperCase()
        const ads = b.ads_code || "ADS"
        const audience = (b.audience || "30ALL").trim()
        return `${sku}_${todayDM()}_${mkt}_${sp}_${ads}_${audience}_${vdCode}`
      })()
      const campaign = await callFb("POST", `/${adAcc}/campaigns`, {
        name: campaignName,
        objective: "OUTCOME_SALES",
        status: "PAUSED",
        special_ad_categories: [],
        is_adset_budget_sharing_enabled: false,
        daily_budget: dailyBudget, // CBO — budget ở cấp campaign
        bid_strategy: "LOWEST_COST_WITHOUT_CAP", // bắt buộc ở campaign khi CBO bật
      })
      if (!b.pixel_id) return res.status(400).json({ error: "Thiếu pixel_id — bắt buộc để tạo adset (optimization_goal=OFFSITE_CONVERSIONS)" })
      const promotedObject: any = {
        pixel_id: b.pixel_id,
        custom_event_type: b.custom_event_type || "COMPLETE_REGISTRATION",
        smart_pse_enabled: false,
      }
      const adset = await callFb("POST", `/${adAcc}/adsets`, {
        name: vdCode,
        campaign_id: campaign.id,
        billing_event: "IMPRESSIONS",
        optimization_goal: "OFFSITE_CONVERSIONS",
        promoted_object: promotedObject,
        targeting: buildTargeting(b),
        attribution_spec: ATTRIBUTION_STD,
        status: "PAUSED",
      })
      const creative = await callFb("POST", `/${adAcc}/adcreatives`, {
        name: `${vdCode} creative`,
        object_story_id,
        url_tags: UTM_STATIC,
      })
      const ad = await callFb("POST", `/${adAcc}/ads`, {
        name: adName,
        adset_id: adset.id,
        creative: { creative_id: creative.id },
        status: "PAUSED",
      })
      return res.json({
        mode, campaign_id: campaign.id, campaign_name: campaignName,
        adset_id: adset.id, ad_id: ad.id, creative_id: creative.id,
        dark_post_id: post_id, object_story_id,
        adsmanager_url: `https://business.facebook.com/adsmanager/manage/campaigns?act=${adAcc.replace("act_", "")}`,
      })
    }

    // ── MODE A/B: cần post_id từ bài đã đăng ─────────────────────────────
    if (!b.post_id) return res.status(400).json({ error: "Thiếu post_id" })

    // Lấy post + video info
    const { rows: [post] } = await pool.query(
      `SELECT p.*, v.vd_code, v.product, v.maker
         FROM fb_scheduled_post p
         LEFT JOIN mkt_video v ON v.id = p.video_id
        WHERE p.id = $1`,
      [b.post_id]
    )
    if (!post) return res.status(404).json({ error: "Không tìm thấy bài đăng" })
    if (!post.post_id) return res.status(400).json({ error: "Bài chưa có post_id trên FB (chưa đăng thành công)" })

    const objectStoryId = `${post.page_id}_${post.post_id}`
    const vdCode = post.vd_code || "VD"
    const adName = buildAdName(vdCode, post.post_id)

    // ── MODE A: thêm Ad vào adset có sẵn ──────────────────────────────────
    if (mode === "existing_adset") {
      if (!b.adset_id) return res.status(400).json({ error: "Thiếu adset_id" })

      // 1. Tạo creative
      const creative = await callFb("POST", `/${adAcc}/adcreatives`, {
        name: `${vdCode} creative`,
        object_story_id: objectStoryId,
        url_tags: UTM_STATIC,
      })
      // 2. Tạo ad (PAUSED)
      const ad = await callFb("POST", `/${adAcc}/ads`, {
        name: adName,
        adset_id: b.adset_id,
        creative: { creative_id: creative.id },
        status: "PAUSED",
      })

      await pool.query(
        `UPDATE fb_scheduled_post SET adset_id = $1, ad_id = $2, boost_status = 'active' WHERE id = $3`,
        [b.adset_id, ad.id, b.post_id]
      )
      return res.json({
        mode, ad_id: ad.id, adset_id: b.adset_id, creative_id: creative.id,
        adsmanager_url: `https://business.facebook.com/adsmanager/manage/ads?act=${adAcc.replace("act_", "")}`,
      })
    }

    // ── MODE B: tạo campaign mới ─────────────────────────────────────────
    let dailyBudget: number
    try { dailyBudget = resolveDailyBudget(b) } catch (e: any) { return res.status(400).json({ error: e.message }) }

    // Tên campaign: ưu tiên client gửi, không thì tự sinh
    const campaignName: string = b.campaign_name?.trim() || (() => {
      const sku = (b.sku_code || "PHVVN").toUpperCase()
      const mkt = (auth.mktCode || post.maker || "MKT").toUpperCase()
      const sp = (post.product || "SP").toUpperCase()
      const ads = b.ads_code || "ADS"
      const audience = (b.audience || "30ALL").trim()
      return `${sku}_${todayDM()}_${mkt}_${sp}_${ads}_${audience}_${vdCode}`
    })()

    // 1. Campaign (PAUSED) — CBO: budget ở cấp campaign
    const campaign = await callFb("POST", `/${adAcc}/campaigns`, {
      name: campaignName,
      objective: "OUTCOME_SALES",
      status: "PAUSED",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      daily_budget: dailyBudget,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP", // bắt buộc ở campaign khi CBO bật
    })

    // 2. Ad Set (PAUSED) — targeting + pixel + loại trừ audiences
    if (!b.pixel_id) return res.status(400).json({ error: "Thiếu pixel_id — bắt buộc để tạo adset (optimization_goal=OFFSITE_CONVERSIONS)" })
    const promotedObject: any = {
      pixel_id: b.pixel_id,
      custom_event_type: b.custom_event_type || "COMPLETE_REGISTRATION",
      smart_pse_enabled: false,
    }

    const adset = await callFb("POST", `/${adAcc}/adsets`, {
      name: vdCode,
      campaign_id: campaign.id,
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      promoted_object: promotedObject,
      targeting: buildTargeting(b),
      attribution_spec: ATTRIBUTION_STD,
      status: "PAUSED",
    })

    // 3. Creative với CTA + URL + UTM
    const creativeBody: any = {
      name: `${vdCode} creative`,
      object_story_id: objectStoryId,
      url_tags: UTM_STATIC,
    }
    const creative = await callFb("POST", `/${adAcc}/adcreatives`, creativeBody)

    // 4. Ad (PAUSED)
    const ad = await callFb("POST", `/${adAcc}/ads`, {
      name: adName,
      adset_id: adset.id,
      creative: { creative_id: creative.id },
      status: "PAUSED",
    })

    await pool.query(
      `UPDATE fb_scheduled_post SET campaign_id = $1, adset_id = $2, ad_id = $3, boost_status = 'active' WHERE id = $4`,
      [campaign.id, adset.id, ad.id, b.post_id]
    )

    return res.json({
      mode, campaign_id: campaign.id, adset_id: adset.id, ad_id: ad.id, creative_id: creative.id,
      campaign_name: campaignName,
      adsmanager_url: `https://business.facebook.com/adsmanager/manage/campaigns?act=${adAcc.replace("act_", "")}`,
    })
  } catch (err: any) {
    console.error("[boost POST] error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
