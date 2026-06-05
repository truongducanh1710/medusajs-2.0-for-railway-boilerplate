import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "../../../../lib/constants"

let cache: { products: { name: string; code: string }[]; at: number } | null = null
const TTL = 10 * 60 * 1000 // 10 phút

/**
 * GET /admin/marketing-video/products
 * Lấy danh sách sản phẩm từ Pancake POS — tên + mã SP (code)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (cache && Date.now() - cache.at < TTL) {
      return res.json({ products: cache.products })
    }

    if (!PANCAKE_API_KEY || !PANCAKE_SHOP_ID) {
      return res.status(503).json({ error: "Chưa cấu hình PANCAKE_API_KEY" })
    }

    const products: { name: string; code: string }[] = []
    let page = 1

    while (true) {
      const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/products?api_key=${PANCAKE_API_KEY}&page=${page}&limit=100`
      const r = await fetch(url)
      if (!r.ok) break
      const data = await r.json()
      const items: any[] = data.data ?? data.products ?? []
      if (!items.length) break

      for (const p of items) {
        // Mã SP ưu tiên: p.code → p.sku → p.barcode → lấy từ tên
        const code: string = (p.code || p.sku || p.barcode || "").trim().toUpperCase()
        const name: string = (p.name || "").trim()
        if (name) products.push({ name, code })
      }

      if (page >= (data.total_pages ?? 1)) break
      page++
    }

    cache = { products, at: Date.now() }
    return res.json({ products })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
