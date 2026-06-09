import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const adsetExpr = `COALESCE(raw->>'p_adset_id', raw->>'adset_id', raw->>'utm_adset_id', raw->>'p_utm_adset_id', raw->'marketing'->>'adset_id')`
const adExpr = `COALESCE(raw->>'p_ad_id', raw->>'ad_id', raw->>'utm_ad_id', raw->>'p_utm_ad_id', raw->'marketing'->>'ad_id')`

/**
 * GET /admin/pancake-sync/report/order-attribution/:id
 * Single order with attribution fields used by ads reporting.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    if (!id) return res.status(400).json({ error: "Missing order id" })
    const sql = req.scope.resolve("cskhAnalysisModule") as any

    const rows = await sql.sql(`
      SELECT
        id, source, status, status_name, customer_name, customer_phone,
        total, cod_amount, items, tags, marketer_name, sale_name, care_name,
        fb_campaign_id,
        ${adsetExpr} AS fb_adset_id,
        ${adExpr} AS fb_ad_id,
        raw->>'p_utm_source' AS p_utm_source,
        raw->>'p_utm_campaign' AS p_utm_campaign,
        raw->>'p_utm_medium' AS p_utm_medium,
        raw->>'p_utm_content' AS p_utm_content,
        raw->>'page_id' AS page_id,
        raw->>'page_name' AS page_name,
        pancake_created_at,
        synced_at,
        raw
      FROM pancake_order
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1
    `, [id])

    if (!rows.length) return res.status(404).json({ error: "Order not found" })
    const order = rows[0]
    const matchRows = await sql.sql(`
      SELECT campaign_id, campaign_name, ad_account_id, mkt_name, effective_status, daily_budget, date::text AS latest_date
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL
        AND (
          campaign_id = $1
          OR campaign_name = $2
          OR campaign_name = $3
        )
      ORDER BY date DESC
      LIMIT 5
    `, [order.fb_campaign_id, order.p_utm_campaign, order.p_utm_source]).catch(() => [])

    return res.json({
      order,
      matched_campaigns: matchRows,
      attribution_health: {
        has_campaign_id: Boolean(order.fb_campaign_id),
        has_adset_id: Boolean(order.fb_adset_id),
        has_ad_id: Boolean(order.fb_ad_id),
        matched_campaign_count: matchRows.length,
      },
    })
  } catch (err: any) {
    console.error("[order-attribution]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
