import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncContentVideos } from "../../../../../lib/content-video"

/** POST /admin/ad-content/videos/sync — đọc video của ad mới + làm mới chỉ số video đang chạy. Chỉ đọc FB, ghi DB. */
export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  try {
    return res.json(await syncContentVideos())
  } catch (err: any) {
    console.error("[ad-content/videos/sync]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
