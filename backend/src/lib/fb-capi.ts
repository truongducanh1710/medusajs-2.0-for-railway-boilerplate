import { createHash } from "crypto"

const FB_API_VERSION = "v21.0"
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN ?? ""

// Fallback env var — dùng khi store metadata chưa load được
const PX_CHUNG = process.env.FB_PIXEL_ID ?? "4200470043598330"
const PX_CHUNG_TOKEN = process.env.FB_CAPI_ACCESS_TOKEN ?? FB_ACCESS_TOKEN

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex")
}

function hashOptional(value?: string): string | undefined {
  if (!value?.trim()) return undefined
  return sha256(value)
}

export interface CAPIEvent {
  pixel_id: string
  access_token: string
  event_name: "Purchase" | "CompleteRegistration" | "Lead" | "ViewContent"
  event_time: number
  event_id: string       // dedup key — dùng order_id để tránh bắn 2 lần
  event_source_url?: string
  // Customer data — càng nhiều FB match càng tốt
  phone?: string
  email?: string
  first_name?: string
  last_name?: string
  city?: string          // tỉnh/thành
  fbclid?: string
  fbp?: string
  fbc?: string
  client_ip_address?: string
  client_user_agent?: string
  value?: number
  currency?: string
  order_id?: string
  content_ids?: string[]
}

export async function sendCAPIEvent(event: CAPIEvent): Promise<void> {
  if (!event.access_token) {
    console.warn(`[FB CAPI] No token for pixel ${event.pixel_id} — skip`)
    return
  }

  const userData: Record<string, string> = {}

  // Identifiers — hash theo chuẩn FB SHA256
  if (event.phone) userData.ph = sha256(event.phone.replace(/\D/g, ""))
  if (event.email) { const h = hashOptional(event.email); if (h) userData.em = h }
  if (event.first_name) { const h = hashOptional(event.first_name); if (h) userData.fn = h }
  if (event.last_name) { const h = hashOptional(event.last_name); if (h) userData.ln = h }
  if (event.city) { const h = hashOptional(event.city); if (h) userData.ct = h }
  userData.country = sha256("vn") // Việt Nam cố định

  // FB cookie
  if (event.fbp) userData.fbp = event.fbp
  if (event.fbc) userData.fbc = event.fbc
  if (event.client_ip_address) userData.client_ip_address = event.client_ip_address
  if (event.client_user_agent) userData.client_user_agent = event.client_user_agent
  if (event.fbclid && !event.fbc) {
    userData.fbc = `fb.1.${event.event_time * 1000}.${event.fbclid}`
  }

  const payload = {
    data: [{
      event_name: event.event_name,
      event_time: event.event_time,
      event_id: event.event_id,
      event_source_url: event.event_source_url ?? "https://phanviet.vn",
      action_source: "website",
      user_data: userData,
      custom_data: {
        currency: event.currency ?? "VND",
        value: event.value ?? 0,
        order_id: event.order_id ?? event.event_id,
        ...(event.order_id ? { external_id: event.order_id } : {}),
        ...(event.content_ids ? { content_ids: event.content_ids, content_type: "product" } : {}),
      },
    }],
  }

  const url = `https://graph.facebook.com/${FB_API_VERSION}/${event.pixel_id}/events?access_token=${event.access_token}`

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const json = await res.json() as any
    if (json.error) {
      console.error(`[FB CAPI] Error pixel=${event.pixel_id} event=${event.event_name}: ${json.error.message}`)
    } else {
      console.log(`[FB CAPI] ✓ ${event.event_name} → pixel ${event.pixel_id} | received=${json.events_received}`)
    }
  } catch (err: any) {
    console.error("[FB CAPI] fetch error:", err.message)
  }
}

/**
 * Bắn CompleteRegistration ngay khi order được tạo (server-side, không phụ thuộc trang thank-you).
 * Bắn về 2 pixel:
 *   1. PX_CHUNG (pixel chung toàn store)
 *   2. Pixel riêng sản phẩm (nếu có, lấy từ product.metadata.fb_pixel_id)
 */
export async function sendCompleteRegistrationEvent(params: {
  orderId: string
  phone?: string
  email?: string
  customerName?: string
  city?: string
  fbclid?: string
  fbp?: string
  fbc?: string
  client_ip_address?: string
  client_user_agent?: string
  value: number
  contentIds?: string[]
  storePixelId?: string      // lấy từ store metadata fb_pixel_id
  storeCapiToken?: string    // lấy từ store metadata fb_capi_token
  productPixelId?: string
  productCapiToken?: string
  utmCampaign?: string
  utmContent?: string
  utmSource?: string
  utmMedium?: string
  campaignId?: string
  adsetId?: string
  adId?: string
}): Promise<void> {
  const eventTime = Math.floor(Date.now() / 1000)
  const eventId = `complete_registration_${params.orderId}`

  const nameParts = params.customerName?.trim().split(/\s+/) ?? []
  const firstName = nameParts[0]
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined

  const customDataExtras: Record<string, any> = {}
  if (params.utmCampaign) customDataExtras.utm_campaign = params.utmCampaign
  if (params.utmContent) customDataExtras.utm_content = params.utmContent
  if (params.utmSource) customDataExtras.utm_source = params.utmSource
  if (params.utmMedium) customDataExtras.utm_medium = params.utmMedium
  if (params.campaignId) customDataExtras.campaign_id = params.campaignId
  if (params.adsetId) customDataExtras.adset_id = params.adsetId
  if (params.adId) customDataExtras.ad_id = params.adId

  const sendToPixel = async (pixelId: string, accessToken: string) => {
    const userData: Record<string, string> = {}
    if (params.phone) userData.ph = sha256(params.phone.replace(/\D/g, ""))
    if (params.email) { const h = hashOptional(params.email); if (h) userData.em = h }
    if (firstName) { const h = hashOptional(firstName); if (h) userData.fn = h }
    if (lastName) { const h = hashOptional(lastName); if (h) userData.ln = h }
    if (params.city) { const h = hashOptional(params.city); if (h) userData.ct = h }
    userData.country = sha256("vn")
    if (params.fbp) userData.fbp = params.fbp
    if (params.fbc) userData.fbc = params.fbc
    if (params.fbclid && !params.fbc) userData.fbc = `fb.1.${eventTime * 1000}.${params.fbclid}`
    if (params.client_ip_address) userData.client_ip_address = params.client_ip_address
    if (params.client_user_agent) userData.client_user_agent = params.client_user_agent

    const payload = {
      data: [{
        event_name: "CompleteRegistration",
        event_time: eventTime,
        event_id: eventId,
        event_source_url: "https://phanviet.vn",
        action_source: "website",
        user_data: userData,
        custom_data: {
          currency: "VND",
          value: params.value,
          order_id: params.orderId,
          external_id: params.orderId,
          ...(params.contentIds ? { content_ids: params.contentIds, content_type: "product" } : {}),
          ...customDataExtras,
        },
      }],
    }

    const url = `https://graph.facebook.com/${FB_API_VERSION}/${pixelId}/events?access_token=${accessToken}`
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      const json = await res.json() as any
      if (json.error) {
        console.error(`[FB CAPI] CompleteRegistration error pixel=${pixelId}: ${json.error.message}`)
      } else {
        console.log(`[FB CAPI] ✓ CompleteRegistration → pixel ${pixelId} | order=${params.orderId} | received=${json.events_received}`)
      }
    } catch (err: any) {
      console.error(`[FB CAPI] CompleteRegistration fetch error pixel=${pixelId}:`, err.message)
    }
  }

  const pxChung = params.storePixelId || PX_CHUNG
  const pxChungToken = params.storeCapiToken || PX_CHUNG_TOKEN

  // 1. Pixel chung (từ store metadata, fallback env var)
  await sendToPixel(pxChung, pxChungToken)

  // 2. Pixel riêng sản phẩm (nếu khác pixel chung và có token)
  if (params.productPixelId && params.productCapiToken && params.productPixelId !== pxChung) {
    await sendToPixel(params.productPixelId, params.productCapiToken)
  }
}

/**
 * Bắn Purchase khi đơn giao thành công (Pancake status=3)
 * Bắn về 2 pixel:
 *   1. PX_CHUNG (pixel chung toàn store)
 *   2. Pixel riêng sản phẩm (nếu có, lấy từ product.metadata.fb_pixel_id)
 */
export async function sendPurchaseEvent(params: {
  orderId: string
  phone?: string
  email?: string
  customerName?: string
  city?: string
  fbclid?: string
  fbp?: string
  fbc?: string
  client_ip_address?: string
  client_user_agent?: string
  value: number
  storePixelId?: string
  storeCapiToken?: string
  productPixelId?: string
  productCapiToken?: string
  contentIds?: string[]
}): Promise<void> {
  const eventTime = Math.floor(Date.now() / 1000)
  // dedup key: cùng 1 order_id → FB chỉ tính 1 lần dù bắn nhiều pixel
  const eventId = `purchase_${params.orderId}`

  // Split full name thành first/last
  const nameParts = params.customerName?.trim().split(/\s+/) ?? []
  const firstName = nameParts.length > 1 ? nameParts[0] : nameParts[0]
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined

  const baseEvent = {
    event_name: "Purchase" as const,
    event_time: eventTime,
    event_id: eventId,
    event_source_url: "https://phanviet.vn",
    phone: params.phone,
    email: params.email,
    first_name: firstName,
    last_name: lastName,
    city: params.city,
    fbclid: params.fbclid,
    fbp: params.fbp,
    fbc: params.fbc,
    client_ip_address: params.client_ip_address,
    client_user_agent: params.client_user_agent,
    value: params.value,
    currency: "VND",
    order_id: params.orderId,
    content_ids: params.contentIds,
  }

  const pxChung = params.storePixelId || PX_CHUNG
  const pxChungToken = params.storeCapiToken || PX_CHUNG_TOKEN

  // 1. Pixel chung (từ store metadata, fallback env var)
  await sendCAPIEvent({ ...baseEvent, pixel_id: pxChung, access_token: pxChungToken })

  // 2. Pixel riêng sản phẩm (nếu khác pixel chung và có token)
  if (params.productPixelId && params.productCapiToken && params.productPixelId !== pxChung) {
    await sendCAPIEvent({ ...baseEvent, pixel_id: params.productPixelId, access_token: params.productCapiToken })
  }
}
