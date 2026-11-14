import { MedusaContainer } from "@medusajs/framework"
import { syncRecentOrderFunnel } from "../lib/order-funnel"

/**
 * Job: dựng lại order_funnel cho đơn tạo 3 ngày gần nhất + đơn vừa đổi trong 30 phút (lib/order-funnel.ts).
 * Chỉ đọc DB, không gọi API ngoài.
 */
export default async function orderFunnelSync(_container: MedusaContainer) {
  const t0 = Date.now()
  try {
    const r = await syncRecentOrderFunnel((m) => console.log(`[OrderFunnel] ${m}`))
    if (!r.skipped) console.log(`[OrderFunnel] recent done → orders=${r.orders} batches=${r.batches} in ${Date.now() - t0}ms`)
  } catch (e: any) {
    console.error("[OrderFunnel] recent failed:", e?.message)
  }
}

export const config = {
  name: "order-funnel-sync",
  schedule: "*/15 * * * *",
}
