import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPosTags, QUICK_TAGS, CANCEL_REASON_TAG, TAG_SUGGEST } from "../../../../../lib/sale-queue"

/**
 * GET /admin/pancake-sync/call-board/tags
 * Thẻ đơn của shop cho thẻ đơn trên hàng đợi: danh sách thẻ, thẻ hay dùng, lý do hủy và
 * bảng gợi ý theo kết quả cuộc gọi. Chỉ để GỢI Ý — sale bấm mới gắn.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    res.json({
      tags: await getPosTags(),
      quick: QUICK_TAGS,
      cancel_reasons: Object.entries(CANCEL_REASON_TAG).map(([label, id]) => ({ label, id })),
      suggest: TAG_SUGGEST,
    })
  } catch (err: any) {
    res.status(502).json({ error: err.message })
  }
}
