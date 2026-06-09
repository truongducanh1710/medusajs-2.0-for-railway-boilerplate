import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, ensureTables, callFb, getFbAdInfo, createUnpublishedPost, getPageTokens } from "../_lib"

// ── Naming helpers (mirror src/admin/lib/camp-naming.ts) ────────────────────
const UTM_STATIC =
  "utm_source={{campaign.name}}&utm_medium={{adset.name}}&utm_campaign={{campaign.id}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}"
const OFFLINE_DATASET_ID = "941188901527786" // PX CHUNG VIETNAM

const todayDM = (d = new Date()) => `${d.getDate()}/${d.getMonth() + 1}`
const buildAdName = (vd: string, postId: string) => `${vd} - ${postId}`

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

      // Clone creative (reuse object_story_id hoặc video_id)
      const creativeBody: Record<string, any> = {
        name: `${adInfo.ad_name} - clone`,
        url_tags: UTM_STATIC,
      }
      if (srcCreative.object_story_id) {
        creativeBody.object_story_id = srcCreative.object_story_id
      } else if (srcCreative.video_id) {
        creativeBody.object_story_id = srcCreative.object_story_id || ""
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
      })
      const targeting: any = {
        geo_locations: { countries: ["VN"], location_types: ["home", "recent"] },
        age_min: Number(b.age_min) || 25,
        locales: [27],
        targeting_automation: { advantage_audience: 1 },
      }
      if (Array.isArray(b.excluded_audience_ids) && b.excluded_audience_ids.length > 0)
        targeting.excluded_custom_audiences = b.excluded_audience_ids.map((id: string) => ({ id }))
      const promotedObject: any = { offline_conversion_data_set_id: OFFLINE_DATASET_ID }
      if (b.pixel_id) promotedObject.pixel_id = b.pixel_id
      const adset = await callFb("POST", `/${adAcc}/adsets`, {
        name: b.adset_name || adInfo.adset.name || "Ad Set",
        campaign_id: campaign.id,
        daily_budget: Number(b.daily_budget) || 500000,
        billing_event: "IMPRESSIONS",
        optimization_goal: "OFFSITE_CONVERSIONS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        promoted_object: promotedObject,
        targeting,
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
      const dailyBudget = Number(b.daily_budget) || 500000
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
      })
      const targeting: any = {
        geo_locations: { countries: ["VN"], location_types: ["home", "recent"] },
        age_min: Number(b.age_min) || 25,
        locales: [27],
        targeting_automation: { advantage_audience: 1 },
      }
      if (Array.isArray(b.excluded_audience_ids) && b.excluded_audience_ids.length > 0)
        targeting.excluded_custom_audiences = b.excluded_audience_ids.map((id: string) => ({ id }))
      const promotedObject: any = { offline_conversion_data_set_id: OFFLINE_DATASET_ID }
      if (b.pixel_id) promotedObject.pixel_id = b.pixel_id
      const adset = await callFb("POST", `/${adAcc}/adsets`, {
        name: vdCode,
        campaign_id: campaign.id,
        daily_budget: dailyBudget,
        billing_event: "IMPRESSIONS",
        optimization_goal: "OFFSITE_CONVERSIONS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        promoted_object: promotedObject,
        targeting,
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
    const dailyBudget = Number(b.daily_budget) || 500000
    if (dailyBudget < 50000) return res.status(400).json({ error: "Ngân sách tối thiểu 50.000đ" })

    // Tên campaign: ưu tiên client gửi, không thì tự sinh
    const campaignName: string = b.campaign_name?.trim() || (() => {
      const sku = (b.sku_code || "PHVVN").toUpperCase()
      const mkt = (auth.mktCode || post.maker || "MKT").toUpperCase()
      const sp = (post.product || "SP").toUpperCase()
      const ads = b.ads_code || "ADS"
      const audience = (b.audience || "30ALL").trim()
      return `${sku}_${todayDM()}_${mkt}_${sp}_${ads}_${audience}_${vdCode}`
    })()

    // 1. Campaign (PAUSED)
    const campaign = await callFb("POST", `/${adAcc}/campaigns`, {
      name: campaignName,
      objective: "OUTCOME_SALES",
      status: "PAUSED",
      special_ad_categories: [],
    })

    // 2. Ad Set (PAUSED) — targeting + pixel + loại trừ audiences
    const targeting: any = {
      geo_locations: { countries: ["VN"], location_types: ["home", "recent"] },
      age_min: Number(b.age_min) || 25,
      locales: [27],
      targeting_automation: { advantage_audience: 1 },
    }
    if (Array.isArray(b.excluded_audience_ids) && b.excluded_audience_ids.length > 0) {
      targeting.excluded_custom_audiences = b.excluded_audience_ids.map((id: string) => ({ id }))
    }

    const promotedObject: any = { offline_conversion_data_set_id: OFFLINE_DATASET_ID }
    if (b.pixel_id) promotedObject.pixel_id = b.pixel_id

    const adset = await callFb("POST", `/${adAcc}/adsets`, {
      name: vdCode,
      campaign_id: campaign.id,
      daily_budget: dailyBudget,
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      promoted_object: promotedObject,
      targeting,
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
    return res.status(500).json({ error: err.message })
  }
}
