import { createHash } from "crypto"

const FB_API_VERSION = "v21.0"
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN ?? ""

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex")
}

export interface CAPIEvent {
  pixel_id: string
  event_name: "Purchase" | "CompleteRegistration" | "Lead"
  event_time: number          // Unix timestamp
  event_id: string            // dedup key — dùng order ID
  event_source_url?: string
  phone?: string
  fbclid?: string
  fbp?: string
  fbc?: string
  value?: number              // VND
  currency?: string
  order_id?: string
}

export async function sendCAPIEvent(event: CAPIEvent): Promise<void> {
  if (!FB_ACCESS_TOKEN) {
    console.warn("[FB CAPI] FB_ACCESS_TOKEN chưa cấu hình — skip")
    return
  }

  const userData: Record<string, string> = {}
  if (event.phone) userData.ph = sha256(event.phone.replace(/\D/g, ""))
  if (event.fbp) userData.fbp = event.fbp
  if (event.fbc) userData.fbc = event.fbc
  // Nếu có fbclid nhưng chưa có fbc thì tạo
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
      },
    }],
  }

  const url = `https://graph.facebook.com/${FB_API_VERSION}/${event.pixel_id}/events?access_token=${FB_ACCESS_TOKEN}`

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const json = await res.json() as any
    if (json.error) {
      console.error(`[FB CAPI] Error pixel=${event.pixel_id} event=${event.event_name}:`, json.error.message)
    } else {
      console.log(`[FB CAPI] ✓ Sent ${event.event_name} → pixel ${event.pixel_id} | events_received=${json.events_received}`)
    }
  } catch (err: any) {
    console.error("[FB CAPI] fetch error:", err.message)
  }
}

// Map SĐT marketer/UTM content → pixel ID
// Cập nhật khi thêm marketer mới
const MARKETER_PIXEL_MAP: Record<string, string> = {
  XUANLT:  "1487834185630970",  // PX_GIA DUNG_XUANLT_CHAO VANG
  NAMDV:   "1921074788473811",  // PX_NAMDV_PHV_VN
  KIENLB:  "941188901527786",   // PX CHUNG VIETNAM
  ANHNT:   "941188901527786",   // PX CHUNG VIETNAM
  LINHMT:  "941188901527786",   // PX CHUNG VIETNAM (dùng ADS342)
  DEFAULT: "941188901527786",   // fallback
}

export function getPixelForMarketer(marketerName: string): string {
  const key = Object.keys(MARKETER_PIXEL_MAP).find(k =>
    marketerName?.toUpperCase().includes(k)
  )
  return key ? MARKETER_PIXEL_MAP[key] : MARKETER_PIXEL_MAP.DEFAULT
}

// Extract pixel từ utm_content (vd: "VD14 - 122102162228736093")
export function getPixelFromUtmContent(_utmContent: string): string | null {
  // utm_content không chứa pixel ID trực tiếp
  // pixel được xác định theo marketer trong utm_campaign
  return null
}
