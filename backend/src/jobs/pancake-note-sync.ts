/**
 * Pancake active orders sync — chạy mỗi 2 phút.
 *
 * Gọi GET /shops/{id}/orders?status=0 — Pancake trả về toàn bộ đơn status=0
 * (kể cả ngày cũ) trong 1 request, kèm customer.notes + tags trong cùng response.
 * Không cần fetch detail từng đơn → nhanh, không bị rate limit.
 */

import { MedusaContainer } from "@medusajs/framework"

export default async function pancakeActiveOrdersSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("pancakeSyncModule") as any

  try {
    const result = await syncService.syncActiveOrders()
    logger?.info?.(
      `[PancakeActiveSync] total=${result.total} updated=${result.updated} created=${result.created} errors=${result.errors}`
    )
  } catch (err: any) {
    logger?.error?.(`[PancakeActiveSync] Failed: ${err.message}`)
  }
}

export const config = {
  name: "pancake-active-orders-sync",
  schedule: "*/2 * * * *",
}
