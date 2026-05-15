import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const SORT_WHITELIST = new Set([
  "pancake_created_at",
  "total",
  "status",
  "last_note_at",
  "synced_at",
])

/**
 * GET /admin/pancake-sync/orders
 * Filters: from, to, source, status (CSV: "0,1,2"), sale, marketer, province,
 *          min_total, max_total, q (OR across phone/name/id/tracking)
 * Sort:    sort_by (whitelisted), sort_dir (asc|desc, default desc)
 * Paging:  offset, limit
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from,
      to,
      source,
      status,
      sale,
      marketer,
      province,
      min_total,
      max_total,
      q,
      sort_by,
      sort_dir,
      offset = "0",
      limit = "50",
    } = req.query as Record<string, string | undefined>

    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const filters: any = {}

    // Date range
    if (from) filters.pancake_created_at = { ...filters.pancake_created_at, $gte: new Date(from) }
    if (to)   filters.pancake_created_at = { ...filters.pancake_created_at, $lte: new Date(to) }

    // Source
    if (source && source !== "all") filters.source = source

    // Status — hỗ trợ CSV "0,1,2" hoặc 1 giá trị
    if (status !== undefined && status !== "" && status !== "all") {
      const parts = status.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n))
      if (parts.length === 1) filters.status = parts[0]
      else if (parts.length > 1) filters.status = { $in: parts }
    }

    // Sale / Marketer — exact match (vì dropdown chọn từ DB)
    if (sale && sale !== "all")         filters.sale_name = sale
    if (marketer && marketer !== "all") filters.marketer_name = marketer
    if (province && province !== "all") filters.province = province

    // Khoảng tiền
    if (min_total) filters.total = { ...filters.total, $gte: Number(min_total) }
    if (max_total) filters.total = { ...filters.total, $lte: Number(max_total) }

    // Search đa trường (OR)
    if (q && q.trim()) {
      const term = q.trim()
      filters.$or = [
        { customer_phone: { $ilike: `%${term}%` } },
        { customer_name:  { $ilike: `%${term}%` } },
        { id:             { $ilike: `%${term}%` } },
        { tracking_code:  { $ilike: `%${term}%` } },
      ]
    }

    // Sort
    const sortField = sort_by && SORT_WHITELIST.has(sort_by) ? sort_by : "pancake_created_at"
    const sortDir = (sort_dir === "asc" ? "ASC" : "DESC") as "ASC" | "DESC"
    const order: Record<string, "ASC" | "DESC"> = { [sortField]: sortDir }

    const take = Math.min(Number(limit) || 50, 200)
    const skip = Number(offset) || 0

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
      syncService.listPancakeOrders(filters, { take, skip, select: fields, order }),
      syncService.listAndCountPancakeOrders(filters, { take, skip, select: ["id"] }),
    ])

    return res.json({
      orders,
      count,
      hasMore: skip + take < count,
    })
  } catch (err: any) {
    console.error("[PancakeSync Orders API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
