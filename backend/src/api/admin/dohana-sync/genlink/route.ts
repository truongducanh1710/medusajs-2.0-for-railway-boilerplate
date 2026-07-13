import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/dohana-sync/genlink?slug=...
 * Lấy link xem video on-demand qua POST /partner/video/genlink/:slug của Dohana.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const slug = req.query.slug as string | undefined
    if (!slug) return res.status(400).json({ error: "Missing query param: slug" })

    const apiKey = process.env.DOHANA_API_KEY ?? ""
    const url = `https://be.dhn.io.vn/dpm/v1/partner/video/genlink/${slug}`
    const dhRes = await fetch(url, { method: "POST", headers: { "x-api-key": apiKey } })
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
