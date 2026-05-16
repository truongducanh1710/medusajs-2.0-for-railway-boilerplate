import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HOAN_TAGS } from "../../../../modules/cskh-analysis/service"

const URGENCY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

const ALLOWED_SOURCES = ["manual", "facebook", "zalo", "unknown", "medusa"]
const TAG_GIAO_KHONG_THANH = "Giao không thành"
const FIVE_DAYS_MS = 5 * 24 * 3600 * 1000

/**
 * GET /admin/cskh/orders
 * Query: care, limit, offset
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      care,
      limit = "200",
      offset = "0",
    } = req.query as Record<string, string | undefined>

    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const lim = Math.min(Number(limit) || 200, 500)
    const off = Number(offset) || 0

    // $in không hoạt động với MedusaService number field — query riêng 2 status rồi merge
    const selectFields = [
      "id", "status", "status_name", "customer_name", "customer_phone",
      "province", "sale_name", "care_name", "total", "cod_amount",
      "tracking_code", "source", "pancake_created_at", "last_note_at", "tags",
    ]
    const baseFilter: any = {}
    if (care) baseFilter.care_name = care

    const [status2, status4] = await Promise.all([
      syncService.listPancakeOrders(
        { ...baseFilter, status: 2 },
        { take: lim, skip: off, select: selectFields, order: { pancake_created_at: "ASC" } }
      ),
      syncService.listPancakeOrders(
        { ...baseFilter, status: 4 },
        { take: lim, skip: off, select: selectFields, order: { pancake_created_at: "ASC" } }
      ),
    ])

    const allOrders = [...status2, ...status4]

    // Lọc source phía app
    const orders = (allOrders as any[]).filter(o => ALLOWED_SOURCES.includes(o.source))

    if (!orders.length) {
      return res.json({ orders: [], count: 0, ai_count: 0, plain_count: 0 })
    }

    // Query raw + analysis qua CskhAnalysisService (dùng this.sql() hoạt động đúng)
    let analysisMap: Record<string, any> = {}
    let rawMap: Record<string, any> = {}
    try {
      const rows = await cskhService.queryOrdersWithRaw(care)
      for (const r of rows) {
        rawMap[r.id] = r
        if (r.order_id) {
          analysisMap[r.order_id] = {
            current_step: r.current_step,
            next_action: r.next_action,
            call_time: r.call_time,
            urgency: r.urgency,
            priority_score: r.priority_score,
            analyzed_at: r.analyzed_at,
          }
        }
      }
    } catch (e: any) {
      console.warn("[CSKH Orders] raw+analysis query:", e.message)
    }

    const now = Date.now()
    let aiCount = 0
    let plainCount = 0

    const enriched = orders.map((o: any) => {
      const raw = rawMap[o.id] ?? {}
      // Ưu tiên raw_tags từ raw JSON (luôn mới nhất), fallback về field tags
      const rawTagsArr = Array.isArray(raw.raw_tags) ? raw.raw_tags
        : (typeof raw.raw_tags === "string" ? JSON.parse(raw.raw_tags || "[]") : null)
      const tagsArr = rawTagsArr ?? (Array.isArray(o.tags) ? o.tags : [])
      const tags: string[] = tagsArr.map((t: any) => t.name ?? t)
      const hasGKT = tags.includes(TAG_GIAO_KHONG_THANH)
      const analysis = hasGKT ? (analysisMap[o.id] ?? null) : null

      let category = "binh_thuong"
      if (hasGKT) category = "su_co"
      else if (o.status === 4) category = "dang_hoan"
      else {
        const pickedMs = raw.picked_up_at ? new Date(raw.picked_up_at).getTime() : 0
        if (pickedMs && now - pickedMs > FIVE_DAYS_MS) category = "tre_giao"
      }

      const missing_hoan_tag = o.status === 4 && !HOAN_TAGS.some(h => tags.includes(h))

      if (hasGKT) aiCount++; else plainCount++

      return {
        ...o,
        delivery_name: raw.delivery_name ?? null,
        delivery_tel: raw.delivery_tel ?? null,
        partner_status: raw.partner_status ?? null,
        count_of_delivery: raw.count_of_delivery ?? null,
        picked_up_at: raw.picked_up_at ?? null,
        last_delivery_status: raw.last_delivery_status ?? null,
        last_delivery_at: raw.last_delivery_at ?? null,
        current_step: analysis?.current_step ?? null,
        next_action: analysis?.next_action ?? null,
        call_time: analysis?.call_time ?? null,
        urgency: analysis?.urgency ?? null,
        priority_score: analysis?.priority_score ?? 0,
        analyzed_at: analysis?.analyzed_at ?? null,
        row_type: hasGKT ? "ai" : "plain",
        category,
        missing_hoan_tag,
      }
    })

    enriched.sort((a: any, b: any) => {
      if (a.row_type === "ai" && b.row_type !== "ai") return -1
      if (a.row_type !== "ai" && b.row_type === "ai") return 1
      if (a.row_type === "ai" && b.row_type === "ai") {
        const ua = URGENCY_ORDER[a.urgency] ?? 2
        const ub = URGENCY_ORDER[b.urgency] ?? 2
        if (ua !== ub) return ua - ub
        const ca = a.call_time ? new Date(a.call_time).getTime() : Infinity
        const cb = b.call_time ? new Date(b.call_time).getTime() : Infinity
        return ca - cb
      }
      return 0
    })

    return res.json({
      orders: enriched,
      count: enriched.length,
      ai_count: aiCount,
      plain_count: plainCount,
    })
  } catch (err: any) {
    console.error("[CSKH Orders]", err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
