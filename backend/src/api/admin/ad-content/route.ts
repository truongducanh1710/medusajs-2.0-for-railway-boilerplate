import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readAdContent } from "../../../lib/ad-content"

/**
 * GET /admin/ad-content — ad đang chạy và thứ khách thấy, đọc từ bảng ad_content (lib/ad-content.ts).
 * Job jobs/ad-content-sync.ts đồng bộ từ FB 30 phút/lần; làm mới ngay bằng POST /admin/ad-content/sync.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    return res.json(await readAdContent())
  } catch (err: any) {
    console.error("[ad-content]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
