import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, lookupCost, resolveDisplayId } from "../../../gia-von/avg-cost/route"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/pancake-sync/orders/[id]
 * Full detail for a single pancake order including raw JSON and status_history.
 *
 * Kèm `cost_breakdown`: giá vốn từng item của đơn (tra từ bảng giá vốn TB theo mã SP,
 * fallback theo tên). Item quà tặng (giá 0) vẫn có giá vốn — đó là phần "ăn" vào lãi
 * của combo mà nhìn doanh thu không thấy được.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params

    if (!id) {
      return res.status(400).json({ error: "Missing order ID" })
    }

    const syncService = req.scope.resolve("pancakeSyncModule") as any

    const orders = await syncService.listPancakeOrders(
      { id },
      { take: 1 }
    )

    if (orders.length === 0) {
      return res.status(404).json({ error: "Order not found" })
    }

    const order = orders[0]

    // If linked to Medusa, also fetch Medusa order summary
    let medusaOrder: any = null
    if (order.medusa_order_id) {
      try {
        const orderService = req.scope.resolve("orderModuleService") as any
        const medusaOrders = await orderService.listOrders(
          { id: order.medusa_order_id },
          {
            take: 1,
            select: [
              "id",
              "display_id",
              "status",
              "payment_status",
              "fulfillment_status",
              "created_at",
              "total",
            ],
          }
        )
        if (medusaOrders.length > 0) {
          medusaOrder = medusaOrders[0]
        }
      } catch (err: any) {
        console.warn(
          `[PancakeSync Detail] Could not fetch Medusa order ${order.medusa_order_id}:`,
          err.message
        )
      }
    }

    // ── Giá vốn từng item ──────────────────────────────────────────────────────
    // Không chặn response nếu bảng giá vốn lỗi: đơn vẫn phải xem được.
    let costBreakdown: any = null
    try {
      const avgCost = await computeAvgCost(getPool())
      const rawItems: any[] = Array.isArray(order.raw?.items) ? order.raw.items : []

      const items = rawItems.map((mi: any) => {
        const vi = mi?.variation_info ?? {}
        const name = vi.name ?? mi?.name ?? "CHƯA RÕ SP"
        const code = resolveDisplayId(vi.display_id)
        const qty = Number(mi?.quantity ?? 1) || 1
        const price = Number(vi.retail_price ?? mi?.price ?? 0) || 0
        const unitCost = lookupCost(avgCost, code, name)
        return {
          name, code, qty, price,
          revenue: price * qty,
          unit_cost: unitCost,
          cost: unitCost != null ? Math.round(unitCost * qty) : null,
          // Quà tặng: có hàng giao nhưng không thu tiền
          is_gift: price === 0,
        }
      })

      const totalCost = items.reduce((s, i) => s + (i.cost ?? 0), 0)
      const totalRevenue = items.reduce((s, i) => s + i.revenue, 0)
      costBreakdown = {
        items,
        total_cost: totalCost,
        gift_cost: items.filter(i => i.is_gift).reduce((s, i) => s + (i.cost ?? 0), 0),
        total_revenue: totalRevenue,
        // Lãi gộp thô = DT - giá vốn (chưa trừ ship/ads/fullfill)
        gross_profit: totalRevenue - totalCost,
        cost_pct: totalRevenue > 0 ? Math.round(totalCost / totalRevenue * 1000) / 10 : null,
        // Item chưa khai giá vốn → hiện cảnh báo thay vì ngầm tính 0
        missing_cost: items.filter(i => i.cost == null).map(i => i.name),
      }
    } catch (err: any) {
      console.warn("[PancakeSync Detail] cost breakdown failed:", err.message)
    }

    return res.json({
      order,
      medusa_order: medusaOrder,
      cost_breakdown: costBreakdown,
    })
  } catch (err: any) {
    console.error("[PancakeSync Detail API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
