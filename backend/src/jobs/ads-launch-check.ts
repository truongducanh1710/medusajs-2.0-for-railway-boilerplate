import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { runLaunchChecks } from "../lib/ads-launch-check"

/**
 * Quy trình bắt buộc camp mới XUANLT/ANHTD (3 ngày gần nhất): kiểm loại trừ / cài đặt / seeding / Tự scale / ghi theo dõi,
 * tự làm phần làm được (seeding 7h–22h, gắn Tự scale khi có chi tiêu), lỗi thì báo Telegram. Lệch 7 phút với job Tự scale.
 */
export default async function adsLaunchCheckJob(container: MedusaContainer) {
  try {
    const r = await runLaunchChecks(container.resolve(Modules.USER))
    const bad = r.filter((x: any) => x.status && x.status !== "ok").length
    if (r.length) console.log(`[AdsLaunchCheck] camps=${r.length} chưa xong/lỗi=${bad}`)
  } catch (e: any) {
    console.error("[AdsLaunchCheck] error:", e.message)
  }
}

export const config = {
  name: "ads-launch-check",
  schedule: "7,22,37,52 * * * *",
}
