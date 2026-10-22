import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const cache = new Map<string, { at: number; data: any[] }>()
const TTL = 24 * 3600_000
const GEO = "https://pos.pages.fm/api/v1/geo"

async function cached(key: string, path: string, map: (x: any) => any): Promise<any[]> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.data
  const r = await fetch(GEO + path).then((x) => x.json())
  const data = (r?.data ?? []).map(map)
  cache.set(key, { at: Date.now(), data })
  return data
}
const byName = (a: any, b: any) => a.name.localeCompare(b.name, "vi")

/**
 * Pancake address catalog (public endpoints, cached 24h).
 * New (after the 01/07/2025 merger, 2 levels):
 *   GET .../geo                          → 34 provinces (id 84_VNxxx)
 *   GET .../geo?province_id=84_VN103     → wards/communes
 * Old (63 provinces, 3 levels) — many customers still write the old address:
 *   GET .../geo?old=1                    → 63 provinces (+ new_id)
 *   GET .../geo?old=1&province_id=225    → districts
 *   GET .../geo?old=1&district_id=22501  → communes with new_id (null for ~15%: POS cannot
 *                                          convert those and silently ignores the update, so the
 *                                          sale must pick the new ward by hand)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string>
    const id = (v: string) => /^[0-9A-Za-z_]+$/.test(v ?? "")
    if (q.old === "1") {
      if (q.district_id) {
        if (!id(q.district_id)) return res.status(400).json({ error: "district_id không hợp lệ" })
        const communes = await cached(`oc:${q.district_id}`, `/communes?district_id=${q.district_id}`, (c: any) => ({ id: c.id, name: c.name, new_id: c.new_id ?? null }))
        return res.json({ communes: [...communes].sort(byName) })
      }
      if (q.province_id) {
        if (!id(q.province_id)) return res.status(400).json({ error: "province_id không hợp lệ" })
        const districts = await cached(`od:${q.province_id}`, `/districts?province_id=${q.province_id}`, (d: any) => ({ id: d.id, name: d.name }))
        return res.json({ districts: [...districts].sort(byName) })
      }
      const provinces = await cached("op", "/provinces?country_code=84", (p: any) => ({ id: p.id, name: p.name, new_id: p.new_id ?? null }))
      return res.json({ provinces: [...provinces].sort(byName) })
    }
    if (q.province_id) {
      if (!/^84_VN\d+$/.test(q.province_id)) return res.status(400).json({ error: "province_id không hợp lệ" })
      const communes = await cached(`c:${q.province_id}`, `/communes?province_id=${q.province_id}`, (c: any) => ({ id: c.id, name: c.name }))
      return res.json({ communes })
    }
    // is_new=true → the 34 merged provinces with their new names (without it: old 63 list).
    const provinces = await cached("provinces", "/provinces?country_code=84&is_new=true", (p: any) => ({ id: p.id, name: p.name }))
    res.json({ provinces: [...provinces].sort(byName) })
  } catch (err: any) {
    res.status(502).json({ error: err.message })
  }
}
