import { createHash } from "crypto"

const FB_API_VERSION = "v21.0"
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN ?? ""

// Pixel chung toàn store — nhận Purchase từ mọi sản phẩm
const PX_CHUNG = process.env.FB_PIXEL_ID ?? "4200470043598330"
const PX_CHUNG_TOKEN = process.env.FB_CAPI_ACCESS_TOKEN ?? FB_ACCESS_TOKEN

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex")
}

export interface CAPIEvent {
  pixel_id: string
  access_token: string
  event_name: "Purchase" | "CompleteRegistration" | "Lead" | "ViewContent"
  event_time: number
  event_id: string       // dedup key — dùng order_id để tránh bắn 2 lần
  event_source_url?: string
  phone?: string
  fbclid?: string
  fbp?: string
  fbc?: string
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
  if (event.phone) userData.ph = sha256(event.phone.replace(/\D/g, ""))
  if (event.fbp) userData.fbp = event.fbp
  if (event.fbc) userData.fbc = event.fbc
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
 * Bắn Purchase khi đơn giao thành công (Pancake status=3)
 * Bắn về 2 pixel:
 *   1. PX_CHUNG (pixel chung toàn store)
 *   2. Pixel riêng sản phẩm (nếu có, lấy từ product.metadata.fb_pixel_id)
 */
export async function sendPurchaseEvent(params: {
  orderId: string
  phone?: string
  fbclid?: string
  fbp?: string
  fbc?: string
  value: number
  productPixelId?: string   // pixel riêng của sản phẩm
  productCapiToken?: string // token riêng của sản phẩm
  contentIds?: string[]
}): Promise<void> {
  const eventTime = Math.floor(Date.now() / 1000)
  // dedup key: cùng 1 order_id → FB chỉ tính 1 lần dù bắn nhiều pixel
  const eventId = `purchase_${params.orderId}`

  const baseEvent = {
    event_name: "Purchase" as const,
    event_time: eventTime,
    event_id: eventId,
    event_source_url: "https://phanviet.vn",
    phone: params.phone,
    fbclid: params.fbclid,
    fbp: params.fbp,
    fbc: params.fbc,
    value: params.value,
    currency: "VND",
    order_id: params.orderId,
    content_ids: params.contentIds,
  }

  // 1. Bắn về pixel chung
  await sendCAPIEvent({
    ...baseEvent,
    pixel_id: PX_CHUNG,
    access_token: PX_CHUNG_TOKEN,
  })

  // 2. Bắn về pixel riêng sản phẩm (nếu khác pixel chung và có token)
  if (params.productPixelId && params.productCapiToken && params.productPixelId !== PX_CHUNG) {
    await sendCAPIEvent({
      ...baseEvent,
      pixel_id: params.productPixelId,
      access_token: params.productCapiToken,
    })
  }
}
