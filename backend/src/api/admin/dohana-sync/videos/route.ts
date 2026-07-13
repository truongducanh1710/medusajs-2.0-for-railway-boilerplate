import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const SORT_WHITELIST = new Set(["start_time", "duration", "synced_at"])

/**
 * GET /admin/dohana-sync/videos
 * Filters: from, to (start_time range), status (CSV), type, user_email, orderCode (prefix "%")
 * Paging:  page, limit (cap 200)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from,
      to,
      status,
      type,
      user_email,
      orderCode,
      sort_by,
      sort_dir,
      page = "0",
      limit = "50",
    } = req.query as Record<string, string | undefined>

    const syncService = req.scope.resolve("dohanaSyncModule") as any
    const filters: any = {}

    if (from) filters.start_time = { ...filters.start_time, $gte: new Date(from) }
    if (to) filters.start_time = { ...filters.start_time, $lte: new Date(to) }

    if (status && status !== "all") {
      const parts = status.split(",").map((s) => s.trim()).filter(Boolean)
      filters.status = parts.length > 1 ? { $in: parts } : parts[0]
    }

    if (type && type !== "all") filters.type = type
    if (user_email && user_email !== "all") filters.user_email = user_email
    if (orderCode) filters.order_code = { $ilike: `${orderCode.trim()}%` }

    const sortField = sort_by && SORT_WHITELIST.has(sort_by) ? sort_by : "start_time"
    const sortDir = (sort_dir === "asc" ? "ASC" : "DESC") as "ASC" | "DESC"

    const take = Math.min(Number(limit) || 50, 200)
    const skip = (Number(page) || 0) * take

    const fields = [
      "id",
      "order_code",
      "prepare_code",
      "type",
      "status",
      "slug",
      "duration",
      "start_time",
      "user_email",
      "user_name",
      "drive_link",
      "synced_at",
    ]

    const [videos, count] = await Promise.all([
      syncService.listDohanaVideoes(filters, { take, skip, select: fields, order: { [sortField]: sortDir } }),
      syncService.listAndCountDohanaVideoes(filters, { take, skip, select: ["id"] }).then(([, c]: any) => c),
    ])

    return res.json({ videos, count, hasMore: skip + take < count })
  } catch (err: any) {
    console.error("[DohanaSync Videos API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
