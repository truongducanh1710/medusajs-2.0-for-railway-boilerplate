import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
async function sql(query: string, params?: any[]): Promise<any[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(query, params ?? [])
    return result.rows
  } finally {
    client.release()
  }
}

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
      care,
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

    // Sale / Marketer / CSKH — exact match (vì dropdown chọn từ DB)
    if (sale && sale !== "all")         filters.sale_name = sale
    if (marketer && marketer !== "all") filters.marketer_name = marketer
    if (care && care !== "all")         filters.care_name = care
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
      "items",
      "items_count",
      "tracking_code",
      "currency",
      "marketer_name",
      "sale_name",
      "care_name",
      "data_quality",
      "pancake_created_at",
      "synced_at",
      "created_at",
    ]

    const [orders, [, count], aggRows] = await Promise.all([
      syncService.listPancakeOrders(filters, { take, skip, select: fields, order }),
      syncService.listAndCountPancakeOrders(filters, { take, skip, select: ["id"] }),
      (async () => {
        try {
          const conditions: string[] = []
          const aggParams: any[] = []
          let p = 1
          if (from)   { conditions.push(`pancake_created_at >= $${p++}`); aggParams.push(new Date(from)) }
          if (to)     { conditions.push(`pancake_created_at <= $${p++}`); aggParams.push(new Date(to)) }
          if (source && source !== "all") { conditions.push(`source = $${p++}`); aggParams.push(source) }
          if (sale && sale !== "all")     { conditions.push(`sale_name = $${p++}`); aggParams.push(sale) }
          if (marketer && marketer !== "all") { conditions.push(`marketer_name = $${p++}`); aggParams.push(marketer) }
          if (care && care !== "all")     { conditions.push(`care_name = $${p++}`); aggParams.push(care) }
          if (province && province !== "all") { conditions.push(`province = $${p++}`); aggParams.push(province) }
          if (min_total) { conditions.push(`total >= $${p++}`); aggParams.push(Number(min_total)) }
          if (max_total) { conditions.push(`total <= $${p++}`); aggParams.push(Number(max_total)) }
          if (status !== undefined && status !== "" && status !== "all") {
            const parts = status.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n))
            if (parts.length === 1) { conditions.push(`status = $${p++}`); aggParams.push(parts[0]) }
            else if (parts.length > 1) { conditions.push(`status = ANY($${p++}::int[])`); aggParams.push(parts) }
          }
          if (q && q.trim()) {
            const term = `%${q.trim()}%`
            conditions.push(`(customer_phone ILIKE $${p} OR customer_name ILIKE $${p} OR id ILIKE $${p} OR tracking_code ILIKE $${p})`)
            aggParams.push(term); p++
          }
          const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
          const rows = await sql(
            `SELECT SUM(total)::bigint AS total_sum, SUM(cod_amount)::bigint AS cod_sum FROM pancake_order ${where}`,
            aggParams
          )
          return rows[0] ?? null
        } catch { return null }
      })(),
    ])

    return res.json({
      orders,
      count,
      hasMore: skip + take < count,
      totals: aggRows,
    })
  } catch (err: any) {
    console.error("[PancakeSync Orders API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
