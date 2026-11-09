import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { runCvBo } from "../lib/cv-bo"

/**
 * Bộ chảo vàng tự động (lib/cv-bo.ts) — 30 phút/lần: 6h–20h tăng/tắt kiểu Xuân, 21h báo Telegram,
 * 23h về nền + chấm bộ + lên camp mới cho 5h hôm sau, 5h bật lại. Cài đặt bật/tắt/chạy thử ở /app/tu-scale?tab=bo.
 */
export default async function cvBoJob(container: MedusaContainer) {
  try {
    const r = await runCvBo(container.resolve(Modules.USER))
    if (r && !(r as any).skipped) console.log("[CvBo]", JSON.stringify(r).slice(0, 300))
  } catch (e: any) {
    console.error("[CvBo] error:", e.message)
  }
}

export const config = { name: "cv-bo", schedule: "2,32 * * * *" }
