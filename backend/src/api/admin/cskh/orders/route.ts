import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HOAN_TAGS } from "../../../../modules/cskh-analysis/service"

const URGENCY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

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

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    const mgr = (cskhService as any).__container?.manager

    if (!mgr) {
      return res.status(500).json({ error: "DB manager not available" })
    }

    const lim = Number(limit) || 200
    const off = Number(offset) || 0

    // Build queries with $N placeholders (PostgreSQL)
    let aiParamIdx = 1
    const aiParams: any[] = []
    let aiCareClause = ""
    if (care) {
      aiParams.push(care)
      aiCareClause = `AND po.care_name = $${aiParamIdx++}`
    }
    aiParams.push(lim)
    const aiLimitPh = `$${aiParamIdx++}`
    aiParams.push(off)
    const aiOffsetPh = `$${aiParamIdx++}`

    const aiOrders = await mgr.execute(
      `SELECT
         po.id, po.status, po.status_name, po.customer_name, po.customer_phone,
         po.province, po.sale_name, po.care_name, po.total, po.cod_amount,
         po.tracking_code, po.source, po.pancake_created_at, po.last_note_at,
         po.raw->'partner'->>'delivery_name'     AS delivery_name,
         po.raw->'partner'->>'delivery_tel'      AS delivery_tel,
         po.raw->'partner'->>'partner_status'    AS partner_status,
         po.raw->'partner'->>'count_of_delivery' AS count_of_delivery,
         po.raw->'partner'->>'picked_up_at'      AS picked_up_at,
         (po.raw->'partner'->'extend_update'->0->>'status')     AS last_delivery_status,
         (po.raw->'partner'->'extend_update'->0->>'updated_at') AS last_delivery_at,
         po.raw->'tags' AS tags,
         ca.current_step, ca.next_action, ca.call_time,
         ca.urgency, ca.priority_score, ca.analyzed_at,
         'ai' AS row_type
       FROM pancake_order po
       LEFT JOIN cskh_analysis ca ON ca.order_id = po.id
       WHERE po.status IN (2, 4)
         AND po.source IN ('manual', 'facebook', 'zalo', 'unknown', 'medusa')
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(po.raw->'tags','[]'::jsonb)) t
           WHERE t->>'name' = 'Giao không thành'
         )
         ${aiCareClause}
       ORDER BY po.pancake_created_at ASC
       LIMIT ${aiLimitPh} OFFSET ${aiOffsetPh}`,
      aiParams
    )

    let plainParamIdx = 1
    const plainParams: any[] = []
    let plainCareClause = ""
    if (care) {
      plainParams.push(care)
      plainCareClause = `AND po.care_name = $${plainParamIdx++}`
    }
    plainParams.push(lim)
    const plainLimitPh = `$${plainParamIdx++}`
    plainParams.push(off)
    const plainOffsetPh = `$${plainParamIdx++}`

    const plainOrders = await mgr.execute(
      `SELECT
         po.id, po.status, po.status_name, po.customer_name, po.customer_phone,
         po.province, po.sale_name, po.care_name, po.total, po.cod_amount,
         po.tracking_code, po.source, po.pancake_created_at, po.last_note_at,
         po.raw->'partner'->>'delivery_name'     AS delivery_name,
         po.raw->'partner'->>'delivery_tel'      AS delivery_tel,
         po.raw->'partner'->>'partner_status'    AS partner_status,
         po.raw->'partner'->>'count_of_delivery' AS count_of_delivery,
         po.raw->'partner'->>'picked_up_at'      AS picked_up_at,
         (po.raw->'partner'->'extend_update'->0->>'status')     AS last_delivery_status,
         (po.raw->'partner'->'extend_update'->0->>'updated_at') AS last_delivery_at,
         po.raw->'tags' AS tags,
         NULL AS current_step, NULL AS next_action, NULL AS call_time,
         NULL AS urgency, 0 AS priority_score, NULL AS analyzed_at,
         'plain' AS row_type
       FROM pancake_order po
       WHERE po.status IN (2, 4)
         AND po.source IN ('manual', 'facebook', 'zalo', 'unknown', 'medusa')
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(po.raw->'tags','[]'::jsonb)) t
           WHERE t->>'name' = 'Giao không thành'
         )
         ${plainCareClause}
       ORDER BY po.pancake_created_at ASC
       LIMIT ${plainLimitPh} OFFSET ${plainOffsetPh}`,
      plainParams
    )

    const now = Date.now()
    const FIVE_DAYS_MS = 5 * 24 * 3600 * 1000

    function getCategory(order: any): string {
      const tags: any[] = Array.isArray(order.tags) ? order.tags : (order.tags ? JSON.parse(order.tags) : [])
      const tagNames = tags.map((t: any) => t.name ?? t)
      if (tagNames.includes("Giao không thành")) return "su_co"
      if (order.status === 4) return "dang_hoan"
      const pickedMs = order.picked_up_at ? new Date(order.picked_up_at).getTime() : 0
      if (pickedMs && now - pickedMs > FIVE_DAYS_MS) return "tre_giao"
      return "binh_thuong"
    }

    function getMissingHoanTag(order: any): boolean {
      if (order.status !== 4) return false
      const tags: any[] = Array.isArray(order.tags) ? order.tags : (order.tags ? JSON.parse(order.tags) : [])
      const tagNames = tags.map((t: any) => t.name ?? t)
      return !HOAN_TAGS.some(h => tagNames.includes(h))
    }

    const enriched = [...aiOrders, ...plainOrders].map((o: any) => ({
      ...o,
      tags: typeof o.tags === "string" ? JSON.parse(o.tags || "[]") : (o.tags ?? []),
      category: getCategory(o),
      missing_hoan_tag: getMissingHoanTag(o),
    }))

    enriched.sort((a, b) => {
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
      ai_count: aiOrders.length,
      plain_count: plainOrders.length,
    })
  } catch (err: any) {
    console.error("[CSKH Orders]", err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
