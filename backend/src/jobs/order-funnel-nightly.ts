import { MedusaContainer } from "@medusajs/framework"
import { syncNightlyOrderFunnel } from "../lib/order-funnel"

/**
 * Job đêm: quét lại order_funnel cho đơn tạo trong 60 ngày (giao/huỷ/hoàn chốt muộn) và lấp tối đa
 * 15.000 đơn còn thiếu từ 2026-07-20 → backfill tự hoàn tất sau vài đêm kể cả khi không bấm tay.
 */
export default async function orderFunnelNightly(_container: MedusaContainer) {
  const t0 = Date.now()
  try {
    const r = await syncNightlyOrderFunnel((m) => console.log(`[OrderFunnelNightly] ${m}`))
    if (!r.skipped) console.log(`[OrderFunnelNightly] done → orders=${r.orders} batches=${r.batches} in ${Date.now() - t0}ms`)
  } catch (e: any) {
    console.error("[OrderFunnelNightly] failed:", e?.message)
  }
}

export const config = {
  name: "order-funnel-nightly",
  // 02:40 ICT (GMT+7) = 19:40 UTC
  schedule: "40 19 * * *",
}
