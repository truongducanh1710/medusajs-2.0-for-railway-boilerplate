import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { pos } from "../../../../../lib/sale-queue"

const cache = new Map<string, { at: number; data: any[] }>()
const TTL = 24 * 3600_000

async function cached(key: string, load: () => Promise<any[]>): Promise<any[]> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.data
  const data = await load()
  cache.set(key, { at: Date.now(), data })
  return data
}

/**
 * GET /admin/pancake-sync/call-board/geo            → 34 tỉnh mới (id dạng 84_VNxxx)
 * GET /admin/pancake-sync/call-board/geo?province_id=84_VN103 → phường/xã mới của tỉnh
 * Danh mục địa chỉ sau sáp nhập 01/07/2025 của Pancake (không có cấp huyện).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const provinceId = String((req.query as any).province_id ?? "")
    if (!provinceId) {
      const provinces = await cached("provinces", async () => {
        // is_new=true → the 34 merged provinces with their new names (without it: old 63 list).
        const r = await fetch("https://pos.pages.fm/api/v1/geo/provinces?country_code=84&is_new=true").then((x) => x.json())
        return (r?.data ?? []).map((p: any) => ({ id: p.id, name: p.name })).sort((a: any, b: any) => a.name.localeCompare(b.name, "vi"))
      })
      return res.json({ provinces })
    }
    if (!/^84_VN\d+$/.test(provinceId)) return res.status(400).json({ error: "province_id không hợp lệ" })
    const communes = await cached(`c:${provinceId}`, async () => {
      const r = await fetch(`https://pos.pages.fm/api/v1/geo/communes?province_id=${provinceId}`).then((x) => x.json())
      return (r?.data ?? []).map((c: any) => ({ id: c.id, name: c.name }))
    })
    res.json({ communes })
  } catch (err: any) {
    res.status(502).json({ error: err.message })
  }
}
