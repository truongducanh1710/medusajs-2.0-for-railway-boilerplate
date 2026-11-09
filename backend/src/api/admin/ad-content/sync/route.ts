import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncAdContent } from "../../../../lib/ad-content"

/** POST /admin/ad-content/sync — đọc lại ad đang chạy từ FB ngay (nút "Làm mới từ Facebook"). Chỉ đọc FB, ghi bảng ad_content. */
export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  try {
    return res.json(await syncAdContent())
  } catch (err: any) {
    console.error("[ad-content/sync]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
