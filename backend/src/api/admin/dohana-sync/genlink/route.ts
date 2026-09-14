import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DOHANA_API_BASE } from "../../../../modules/dohana-sync/service"

/**
 * POST /admin/dohana-sync/genlink?slug=...
 * Lấy link xem video on-demand qua POST /partner/video/genlink/:slug của Dohana.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const slug = req.query.slug as string | undefined
    if (!slug) return res.status(400).json({ error: "Missing query param: slug" })

    const apiKey = process.env.DOHANA_API_KEY ?? ""
    // Dùng chung hằng số với service để đổi domain một chỗ (Dohana đã đổi 14/09/2026).
    const url = `${DOHANA_API_BASE}/partner/video/genlink/${slug}`
    const dhRes = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        // Không có User-Agent thì Cloudflare chặn bằng "error code: 1010" (403).
        "User-Agent": "PhanVietSync/1.0 (+https://api.phanviet.vn)",
        Accept: "application/json",
      },
    })
    const data: any = await dhRes.json()

    if (!dhRes.ok || !data.link) {
      return res.status(502).json({ error: data.message || "Không lấy được link video" })
    }

    return res.json({ link: data.link })
  } catch (err: any) {
    console.error("[DohanaSync Genlink API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
