import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { runVideoLifecycle } from "../lib/video-lifecycle"
import { emailsForMkt } from "../lib/auto-scale"

/**
 * Vòng đời video (Test → Win → Scale) cho XUANLT + ANHTD — luật ở lib/video-lifecycle.ts.
 * 9h & 15h VN: chấm và TỰ TẮT ad của video trượt test / video yếu / camp thừa. 21h VN: báo cáo Telegram.
 * Server chạy UTC: 2h, 8h, 14h UTC.
 */
export default async function videoLifecycleJob(container: MedusaContainer) {
  try {
    const userModule = container.resolve(Modules.USER)
    const report = new Date().getUTCHours() === 14
    const emails = [...new Set([...(await emailsForMkt(userModule, "ANHTD")), ...(await emailsForMkt(userModule, "XUANLT"))])]
    const r: any = await runVideoLifecycle({ userModule, emails, report })
    console.log(`[VideoLifecycle] ${report ? "report" : "check"} ${JSON.stringify(r.plan || r)} done=${r.done?.length ?? 0}`)
  } catch (e: any) {
    console.error("[VideoLifecycle] error:", e.message)
  }
}

export const config = {
  name: "video-lifecycle",
  schedule: "0 2,8,14 * * *",
}
