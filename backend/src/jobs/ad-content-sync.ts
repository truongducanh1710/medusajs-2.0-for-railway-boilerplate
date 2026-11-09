import { syncAdContent } from "../lib/ad-content"
import { syncContentVideos } from "../lib/content-video"

/**
 * Đồng bộ nội dung ad đang chạy (bảng ad_content) và hiệu quả theo video (ad_video_map, content_video) cho tab /app/content-ads.
 * 30 phút/lần, lệch khỏi phút 0/15/30/45 để không trùng job chi phí và tự scale.
 */
export default async function adContentSyncJob() {
  try {
    const r = await syncAdContent()
    console.log(`[AdContent] ads=${r.ads} previews=${r.previews_fetched} errors=${r.errors.length}`)
  } catch (e: any) {
    console.error("[AdContent] error:", e.message)
  }
  // Theo video: map ad mới → video, làm mới chỉ số video đang chạy (12h/lần mỗi video)
  try {
    const v = await syncContentVideos()
    console.log(`[ContentVideo] ads=${v.ads_mapped} videos=${v.videos_refreshed}`)
  } catch (e: any) {
    console.error("[ContentVideo] error:", e.message)
  }
}

export const config = {
  name: "ad-content-sync",
  schedule: "12,42 * * * *",
}
