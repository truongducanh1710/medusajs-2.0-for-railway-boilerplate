import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/cskh/analyze
 * Body (optional): { care?: string }
 * Force re-analyze tất cả đơn cần phân tích (hoặc lọc theo care_name).
 * Chạy async — trả về ngay { queued: N }.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { care } = (req.body as any) ?? {}
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const orderIds = await cskhService.getOrdersNeedingAnalysis(care ?? undefined)

    // Chạy async, không block response
    if (orderIds.length > 0) {
      cskhService.analyzeOrders(orderIds).catch((err: any) => {
        console.error("[CSKH Analyze] Background error:", err.message)
      })
    }

    return res.json({ queued: orderIds.length, care: care ?? null })
  } catch (err: any) {
    console.error("[CSKH Analyze]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
