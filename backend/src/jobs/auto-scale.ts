import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { runAutoScale } from "../lib/auto-scale"

/**
 * Tự scale camp theo giờ (kiểu XUANLT) — chỉ camp được gắn bộ điều kiện ở /app/tu-scale.
 * 15 phút/lần: trong khung giờ của rule thì xét tăng/lùi; từ 00:30 thì reset về mức nền.
 */
export default async function autoScaleJob(container: MedusaContainer) {
  try {
    const userModule = container.resolve(Modules.USER)
    const r = await runAutoScale(userModule)
    if (r.checked) console.log(`[AutoScale] checked=${r.checked} actions=${r.actions}`)
  } catch (e: any) {
    console.error("[AutoScale] error:", e.message)
  }
}

export const config = {
  name: "auto-scale",
  schedule: "*/15 * * * *",
}
