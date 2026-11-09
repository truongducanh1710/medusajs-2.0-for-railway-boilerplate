import { syncAdContent } from "../lib/ad-content"

/**
 * Đồng bộ nội dung ad đang chạy cho tab /app/content-ads vào bảng ad_content.
 * 30 phút/lần, lệch khỏi phút 0/15/30/45 để không trùng job chi phí và tự scale.
 */
export default async function adContentSyncJob() {
  try {
    const r = await syncAdContent()
    console.log(`[AdContent] ads=${r.ads} previews=${r.previews_fetched} errors=${r.errors.length}`)
  } catch (e: any) {
    console.error("[AdContent] error:", e.message)
  }
}

export const config = {
  name: "ad-content-sync",
  schedule: "12,42 * * * *",
}
