import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo, callFb } from "../../_lib"

/**
 * GET /admin/fb-content/boost/activity?account_id=act_xxx&campaign_id=xxx&since=YYYY-MM-DD&until=YYYY-MM-DD
 * Lịch sử thay đổi (budget, status, rule tự động) của 1 account, lọc theo campaign_id nếu có.
 * Dùng để agent học pattern tối ưu (bật/tắt theo giờ, scale budget) từ camp đang chạy tốt.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const q = req.query as Record<string, string>
    if (!q.account_id) return res.status(400).json({ error: "Thiếu account_id" })

    const since = q.since || new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const until = q.until || new Date().toISOString().slice(0, 10)
    const limit = Number(q.limit) || 100

    const params = new URLSearchParams({
      fields: "event_type,event_time,translated_event_type,object_name,object_id,extra_data",
      since,
      until,
      limit: String(limit),
    })
    const data = await callFb("GET", `/${q.account_id}/activities?${params.toString()}`)

    let rows: any[] = data.data || []
    if (q.campaign_id) {
      rows = rows.filter(r => r.object_id === q.campaign_id || JSON.stringify(r).includes(q.campaign_id))
    }

    const activities = rows.map(r => ({
      time: r.event_time,
      event_type: r.translated_event_type || r.event_type,
      object_name: r.object_name,
      object_id: r.object_id,
      detail: r.extra_data ? JSON.parse(r.extra_data) : null,
    }))

    return res.json({ account_id: q.account_id, campaign_id: q.campaign_id || null, since, until, count: activities.length, activities })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
