import type { MetadataRoute } from "next"

const SITE = "https://phanviet.vn"
const CC = "vn"
const BACKEND = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "https://api.phanviet.vn"
const KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

// Regenerate hourly so new products and price changes reach crawlers without a deploy
export const revalidate = 3600

async function store<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND}${path}`, { headers: { "x-publishable-api-key": KEY }, next: { revalidate: 3600 } })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

type P = { handle: string | null; updated_at?: string | null; metadata?: Record<string, any> | null }

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const url = (path: string) => `${SITE}/${CC}${path}`
  const entries: MetadataRoute.Sitemap = [
    { url: url(""), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: url("/store"), lastModified: now, changeFrequency: "daily", priority: 0.6 },
    ...["gioi-thieu", "lien-he", "chinh-sach-giao-hang", "chinh-sach-doi-tra", "chinh-sach-kiem-hang", "chinh-sach-thanh-toan", "chinh-sach-bao-mat"]
      .map((p) => ({ url: url(`/${p}`), changeFrequency: "yearly" as const, priority: 0.2 })),
  ]

  const products: P[] = []
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await store<{ products: P[]; count: number }>(`/store/products?limit=100&offset=${offset}&fields=handle,updated_at,+metadata`)
    if (!page?.products?.length) break
    products.push(...page.products)
    if (products.length >= page.count) break
  }

  // ICEgel boxes live on /icegel/<slug> (their canonical), not on the generic product page
  const icegel = products.filter((p) => p.metadata?.bundle_group === "icegel" && p.metadata?.icegel_slug)
  if (icegel.length) {
    entries.push({ url: url("/icegel"), lastModified: now, changeFrequency: "weekly", priority: 0.9 })
    for (const p of icegel) {
      entries.push({ url: url(`/icegel/${p.metadata!.icegel_slug}`), lastModified: p.updated_at ? new Date(p.updated_at) : now, changeFrequency: "weekly", priority: 0.8 })
    }
  }
  for (const p of products) {
    if (!p.handle || icegel.includes(p)) continue
    entries.push({ url: url(`/products/${p.handle}`), lastModified: p.updated_at ? new Date(p.updated_at) : now, changeFrequency: "weekly", priority: 0.7 })
  }

  const cats = await store<{ product_categories: { handle: string }[] }>(`/store/product-categories?limit=200&fields=handle`)
  for (const c of cats?.product_categories ?? []) entries.push({ url: url(`/categories/${c.handle}`), changeFrequency: "weekly", priority: 0.5 })
  const cols = await store<{ collections: { handle: string }[] }>(`/store/collections?limit=200&fields=handle`)
  for (const c of cols?.collections ?? []) if (c.handle && c.handle !== "icegel") entries.push({ url: url(`/collections/${c.handle}`), changeFrequency: "weekly", priority: 0.5 })

  return entries
}
