import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, ensureTables, callFb } from "../_lib"

// ── Naming helpers (mirror src/admin/lib/camp-naming.ts) ────────────────────
const UTM_STATIC =
  "utm_source={{campaign.name}}&utm_medium={{adset.name}}&utm_campaign={{campaign.id}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}"
const OFFLINE_DATASET_ID = "941188901527786" // PX CHUNG VIETNAM

const todayDM = (d = new Date()) => `${d.getDate()}/${d.getMonth() + 1}`
const buildAdName = (vd: string, postId: string) => `${vd} - ${postId}`

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
    if (!b.post_id) return res.status(400).json({ error: "Thiếu post_id" })
    if (!b.ad_account_id) return res.status(400).json({ error: "Thiếu ad_account_id" })

    const pool = getPool()
    await ensureTables(pool)

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
    const adAcc = b.ad_account_id
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
