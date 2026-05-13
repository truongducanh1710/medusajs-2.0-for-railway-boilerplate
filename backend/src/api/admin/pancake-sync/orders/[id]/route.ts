import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/orders/[id]
 * Full detail for a single pancake order including raw JSON and status_history.
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

    return res.json({
      order,
      medusa_order: medusaOrder,
    })
  } catch (err: any) {
    console.error("[PancakeSync Detail API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
