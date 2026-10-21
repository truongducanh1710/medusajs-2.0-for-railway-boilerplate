import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { pos } from "../../../../../lib/sale-queue"

type Variation = { variation_id: string; display_id: string; name: string; price: number; remain: number; hidden: boolean }

let cache: { at: number; list: Variation[] } | null = null
const TTL = 10 * 60_000

async function loadVariations(): Promise<Variation[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.list
  const list: Variation[] = []
  for (let page = 1; page <= 20; page++) {
    const r = await pos("GET", `/products?page_size=100&page_number=${page}`)
    for (const p of r?.data ?? []) {
      for (const v of p.variations ?? []) {
        if (v.is_removed || v.is_locked) continue
        const attrs = (v.fields ?? []).map((f: any) => f.value).filter(Boolean).join(" ")
        list.push({
          variation_id: v.id,
          display_id: v.display_id ?? "",
          name: [p.name, attrs].filter(Boolean).join(" — "),
          price: Number(v.retail_price) || 0,
          remain: Number(v.remain_quantity) || 0,
          hidden: !!v.is_hidden || p.is_published === false,
        })
      }
    }
    if (page >= (r?.total_pages ?? 1)) break
  }
  cache = { at: Date.now(), list }
  return list
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")

/** GET /admin/pancake-sync/call-board/products?q=chao&in_stock=1 — tìm mẫu mã POS để thêm vào đơn. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = fold(String((req.query as any).q ?? "").trim())
    const inStock = (req.query as any).in_stock === "1"
    const words = q.split(/\s+/).filter(Boolean)
    const list = (await loadVariations())
      .filter((v) => !v.hidden && (!inStock || v.remain > 0))
      .filter((v) => words.every((w) => fold(`${v.display_id} ${v.name}`).includes(w)))
      .slice(0, 30)
    res.json({ products: list })
  } catch (err: any) {
    res.status(502).json({ error: err.message })
  }
}
