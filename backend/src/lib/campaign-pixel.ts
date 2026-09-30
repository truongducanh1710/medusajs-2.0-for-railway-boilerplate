// Resolve which pixel an FB campaign optimizes on, so Purchase (COD delivered)
// for Webcake/POS orders — which have no Medusa product to read a pixel from —
// reaches the same pixel the campaign learns from. Before this, those Purchases
// only went to the store-wide pixel and never fed the product pixels campaigns use.

const GRAPH = "https://graph.facebook.com/v25.0"
const TTL_MS = 12 * 60 * 60 * 1000
const cache = new Map<string, { pixel: string | null; at: number }>()

export function systemToken(): string {
  return process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
}

/** Pixel id from the first adset of a campaign that has promoted_object.pixel_id. */
export async function pixelOfCampaign(campaignId: string | undefined | null): Promise<string | null> {
  if (!campaignId || !/^\d{10,20}$/.test(campaignId)) return null
  const hit = cache.get(campaignId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.pixel
  const token = systemToken()
  if (!token) return null
  let pixel: string | null = null
  try {
    const res = await fetch(`${GRAPH}/${campaignId}/adsets?fields=promoted_object&limit=25&access_token=${token}`)
    const json: any = await res.json()
    pixel = (json?.data ?? []).map((a: any) => a?.promoted_object?.pixel_id).find(Boolean) ?? null
  } catch {
    pixel = null
  }
  cache.set(campaignId, { pixel, at: Date.now() })
  return pixel
}

/** Build fbc from the fbclid in a Webcake order link (landing URL with query string). */
export function fbcFromLink(link: string | undefined | null, clickTime?: string | null): string | undefined {
  if (!link) return undefined
  const m = String(link).match(/[?&]fbclid=([^&\s]+)/)
  if (!m) return undefined
  const ts = clickTime ? Date.parse(clickTime.endsWith("Z") ? clickTime : clickTime + "Z") : NaN
  return `fb.1.${Number.isFinite(ts) ? ts : Date.now()}.${decodeURIComponent(m[1])}`
}

/** Marketplace orders are not driven by FB ads — never send them to FB pixels. */
export function isMarketplaceOrder(rawOrder: any): boolean {
  const src = String(rawOrder?.order_sources_name ?? "").toLowerCase()
  return /tiktok|shopee|lazada|tiki/.test(src)
}
