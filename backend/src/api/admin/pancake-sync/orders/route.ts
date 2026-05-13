import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/orders
 * List pancake orders with filters.
 * Query: ?from&to&source=all|medusa|facebook|...&status&q=&offset&limit
 * Note: raw JSON column is excluded from list response for performance.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from,
      to,
      source,
      status,
      q,
      offset = "0",
      limit = "50",
    } = req.query as Record<string, string | undefined>

    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const filters: any = {}

    // Date range filter
    if (from) {
      filters.pancake_created_at = {
        ...filters.pancake_created_at,
        $gte: new Date(from),
      }
    }
    if (to) {
      filters.pancake_created_at = {
        ...filters.pancake_created_at,
        $lte: new Date(to),
      }
    }

    // Source filter
    if (source && source !== "all") {
      filters.source = source
    }

    // Status filter
    if (status !== undefined && status !== "") {
      filters.status = Number(status)
    }

    // Phone search
    if (q) {
      filters.customer_phone = { $ilike: `%${q}%` }
    }

    const take = Math.min(Number(limit) || 50, 200)
    const skip = Number(offset) || 0

    // Select all columns except raw (heavy JSONB)
    const fields = [
      "id",
      "medusa_order_id",
      "source",
      "status",
      "status_name",
      "customer_name",
      "customer_phone",
      "province",
      "total",
      "shipping_fee",
      "cod_amount",
      "items_count",
      "tracking_code",
      "currency",
      "marketer_name",
      "sale_name",
      "data_quality",
      "pancake_created_at",
      "synced_at",
      "created_at",
    ]

    const [orders, [, count]] = await Promise.all([
      syncService.listPancakeOrders(filters, {
        take,
        skip,
        select: fields,
        order: { pancake_created_at: "DESC" },
      }),
      syncService.listAndCountPancakeOrders(filters, {
        take,
        skip,
        select: ["id"],
      }),
    ])

    const hasMore = skip + take < count

    return res.json({
      orders,
      count,
      hasMore,
    })
  } catch (err: any) {
    console.error("[PancakeSync Orders API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
