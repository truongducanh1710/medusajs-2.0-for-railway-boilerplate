import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { transcribeVideo } from "../../../../../lib/content-video"

/** POST /admin/ad-content/videos/transcript { video_id } — chép lời thoại video bằng Gemini, lưu vào content_video. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const videoId = String((req.body as any)?.video_id || "")
  if (!/^\d+$/.test(videoId)) return res.status(400).json({ error: "video_id không hợp lệ" })
  try {
    return res.json({ video_id: videoId, transcript: await transcribeVideo(videoId) })
  } catch (err: any) {
    console.error("[ad-content/videos/transcript]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
