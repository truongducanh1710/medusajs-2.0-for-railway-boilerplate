import { MedusaContainer } from "@medusajs/framework"

export default async function cskhDailyAnalysis(container: MedusaContainer) {
  const logger = container.resolve("logger") as any

  // Chỉ chạy 8h-18h VN (1h-11h UTC)
  const nowUtcHour = new Date().getUTCHours()
  if (nowUtcHour < 1 || nowUtcHour > 11) {
    logger?.info?.("[CskhJob] Ngoài giờ làm việc (8h-18h VN) — bỏ qua")
    return
  }

  logger?.info?.("[CskhJob] Bắt đầu phân tích CSKH vận đơn")

  try {
    const cskhService = container.resolve("cskhAnalysisModule") as any
    const orderIds = await cskhService.getOrdersNeedingAnalysis()

    if (!orderIds.length) {
      logger?.info?.("[CskhJob] Không có đơn nào cần phân tích")
      return
    }

    logger?.info?.(`[CskhJob] Phân tích ${orderIds.length} đơn`)
    await cskhService.analyzeOrders(orderIds)
    logger?.info?.("[CskhJob] Hoàn thành phân tích CSKH")
  } catch (err: any) {
    logger?.error?.(`[CskhJob] Lỗi: ${err.message}`)
  }
}

export const config = {
  name: "cskh-daily-analysis",
  // 8h, 10h, 12h, 14h, 16h, 18h VN = 1h, 3h, 5h, 7h, 9h, 11h UTC
  schedule: "0 1,3,5,7,9,11 * * *",
}
