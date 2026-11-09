import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readContentVideos } from "../../../../lib/content-video"

/** GET /admin/ad-content/videos?from=YYYY-MM-DD&to=YYYY-MM-DD — chi, đơn, % chi phí + chỉ số bài theo từng video (lib/content-video.ts). */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string | undefined>
    return res.json(await readContentVideos(q.from, q.to))
  } catch (err: any) {
    console.error("[ad-content/videos]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
