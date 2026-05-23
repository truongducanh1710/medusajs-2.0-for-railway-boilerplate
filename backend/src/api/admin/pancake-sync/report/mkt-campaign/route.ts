import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/mkt-campaign?date=2026-05-23&mkt=KIENLB
 * Danh sách campaigns FB Ads trong ngày — spend, impressions, clicks.
 * Không JOIN đơn hàng (quá chậm). Dùng để marketer xem chi phí theo camp hôm nay.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { date = today, mkt } = req.query as Record<string, string>

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const params: any[] = [date]
    const mktFilter = mkt ? `AND mkt_name = $2` : ""
    if (mkt) params.push(mkt)

    const rows = await cskhService.sql(`
      SELECT
        campaign_id,
        campaign_name,
        mkt_name,
        spend::bigint,
        impressions::int,
        clicks::int,
        updated_at
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL
        AND date = $1::date
        ${mktFilter}
      ORDER BY spend DESC
    `, params)

    return res.json({ rows, date, mkt: mkt || null })
  } catch (err: any) {
    console.error("[report/mkt-campaign]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
