import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/cskh/analyze — poll tiến độ hiện tại
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const cskhService = req.scope.resolve("cskhAnalysisModule") as any
  return res.json(cskhService.getProgress())
}

/**
 * POST /admin/cskh/analyze
 * Body: { care?: string, force?: boolean }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { care, force } = (req.body as any) ?? {}
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    // Nếu đang chạy → trả về ngay, không queue thêm
    const progress = cskhService.getProgress()
    if (progress.running) {
      return res.json({ running: true, queued: 0, ...progress })
    }

    let orderIds: string[]
    if (force) {
      orderIds = await cskhService.getOrderIdsForForceReanalyze(care ?? undefined)
    } else {
      orderIds = await cskhService.getOrdersNeedingAnalysis(care ?? undefined)
    }

    if (orderIds.length > 0) {
      cskhService.analyzeOrders(orderIds).catch((err: any) => {
        console.error("[CSKH Analyze] Background error:", err.message)
      })
    }

    return res.json({ running: orderIds.length > 0, queued: orderIds.length, care: care ?? null })
  } catch (err: any) {
    console.error("[CSKH Analyze]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
