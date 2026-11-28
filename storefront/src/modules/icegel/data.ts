import { HttpTypes } from "@medusajs/types"
import { sdk } from "@lib/config"
import { getCollectionByHandle } from "@lib/data/collections"
import { parseLanding, type LandingData } from "./components/landing"

export type IcegelItem = {
  id: string
  variantId: string
  slug: string
  handle: string
  title: string
  short: string
  subtitle: string
  description: string
  pack: string
  price: number
  /** List price before discount (metadata.compare_at_price); 0 = no discount */
  compareAt: number
  thumb: string
  images: string[]
  badges: string[]
  benefits: string[]
  line: string
  order: number
  who: string
  how: string
  ingredients: string
  congBo: string
  landing: LandingData | null
  pixelId: string
}

export const LINES: { key: string; label: string }[] = [
  { key: "ho-hap", label: "Mũi – họng" },
  { key: "ha-sot", label: "Hạ sốt" },
  { key: "thu-gian", label: "Mắt – thái dương" },
  { key: "co-am", label: "Cơ – làm ấm" },
]

const list = (raw: unknown): string[] => {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : []
  } catch {
    return []
  }
}

export function toIcegelItem(product: HttpTypes.StoreProduct): IcegelItem | null {
  const m = (product.metadata ?? {}) as Record<string, any>
  const variant = product.variants?.[0]
  if (m.bundle_group !== "icegel" || !variant || !m.icegel_slug) return null
  const price = Number(m.group_unit_price) || Number(variant.calculated_price?.calculated_amount) || 0
  const images = (product.images ?? []).map((image) => image.url).filter(Boolean) as string[]
  return {
    id: product.id,
    variantId: variant.id,
    slug: String(m.icegel_slug),
    handle: product.handle ?? "",
    title: product.title ?? "",
    short: String(m.icegel_short ?? product.title),
    subtitle: product.subtitle ?? "",
    description: product.description ?? "",
    pack: String(m.icegel_pack ?? ""),
    price,
    compareAt: Number(m.compare_at_price) > price ? Number(m.compare_at_price) : 0,
    thumb: product.thumbnail || images[0] || "",
    images: images.length ? images : product.thumbnail ? [product.thumbnail] : [],
    badges: list(m.icegel_badges),
    benefits: list(m.icegel_benefits),
    line: String(m.icegel_line ?? ""),
    order: Number(m.icegel_order) || 99,
    who: String(m.icegel_who ?? ""),
    how: String(m.icegel_how ?? ""),
    ingredients: String(m.icegel_ingredients ?? ""),
    congBo: String(m.icegel_cong_bo ?? ""),
    landing: parseLanding(m.icegel_landing),
    pixelId: String(m.fb_pixel_id ?? ""),
  }
}

export async function getIcegelItems(regionId: string): Promise<IcegelItem[]> {
  const collection = await getCollectionByHandle("icegel").catch(() => null)
  if (!collection) return []
  const { products } = await sdk.store.product.list(
    {
      collection_id: [collection.id],
      region_id: regionId,
      limit: 50,
      fields: "*variants.calculated_price,+metadata,+thumbnail,+images",
    },
    { next: { tags: ["products"] } }
  )
  return products
    .map(toIcegelItem)
    .filter((item): item is IcegelItem => !!item)
    .sort((a, b) => a.order - b.order)
}
