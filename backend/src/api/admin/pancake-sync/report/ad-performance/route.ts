import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { callFbApi } from "../camp-control/_lib"

const adExpr = `COALESCE(raw->>'p_ad_id', raw->>'ad_id', raw->>'utm_ad_id', raw->>'p_utm_ad_id', raw->'marketing'->>'ad_id')`

async function campaignAccount(sql: any, campaignId: string): Promise<string | null> {
  const rows = await sql.sql(`SELECT ad_account_id FROM mkt_ads_cost WHERE campaign_id = $1 ORDER BY date DESC LIMIT 1`, [campaignId]).catch(() => [])
  return rows[0]?.ad_account_id ?? null
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { campaign_id, adset_id, account_id, from, to } = req.query as Record<string, string>
    if (!campaign_id || !from || !to) return res.status(400).json({ error: "campaign_id, from, to are required" })
    const sql = req.scope.resolve("cskhAnalysisModule") as any
    const actId = account_id || await campaignAccount(sql, campaign_id)
    if (!actId) return res.status(404).json({ error: "Cannot infer account_id for campaign" })

    const timeRange = encodeURIComponent(JSON.stringify({ since: from, until: to }))
    const filters: any[] = [{ field: "campaign.id", operator: "EQUAL", value: campaign_id }]
    if (adset_id) filters.push({ field: "adset.id", operator: "EQUAL", value: adset_id })
    const fields = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,ctr,cpm,quality_ranking,engagement_rate_ranking,conversion_rate_ranking"
    const fb = await callFbApi("GET", `/${actId}/insights?level=ad&fields=${fields}&time_range=${timeRange}&filtering=${encodeURIComponent(JSON.stringify(filters))}&limit=300`)
    const insights = fb.data?.data ?? []

    const orders = await sql.sql(`
      SELECT
        ${adExpr} AS ad_id,
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE status IN (1,2,3,4,5))::int AS confirmed,
        SUM(CASE WHEN status NOT IN (-2,7) THEN cod_amount ELSE 0 END)::bigint AS cod_total,
        SUM(CASE WHEN status IN (1,2,3,4,5) THEN cod_amount ELSE 0 END)::bigint AS cod_confirmed
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND fb_campaign_id = $3
      GROUP BY ${adExpr}
    `, [from, to, campaign_id]).catch(() => [])
    const orderMap = new Map(orders.map((o: any) => [o.ad_id, o]))

    const rows = insights.map((r: any) => {
      const hasOrderMatch = orderMap.has(r.ad_id)
      const o = orderMap.get(r.ad_id) ?? {}
      const spend = Math.round(Number(r.spend ?? 0))
      const codTotal = Number((o as any).cod_total ?? 0)
      const vd = String(r.ad_name ?? "").match(/VD\d+/i)?.[0]?.toUpperCase() ?? null
      return {
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        adset_id: r.adset_id,
        adset_name: r.adset_name,
        ad_id: r.ad_id,
        ad_name: r.ad_name,
        vd_code: vd,
        spend,
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        ctr_pct: Number(r.ctr ?? 0),
        cpm: Math.round(Number(r.cpm ?? 0)),
        quality_ranking: r.quality_ranking ?? null,
        engagement_rate_ranking: r.engagement_rate_ranking ?? null,
        conversion_rate_ranking: r.conversion_rate_ranking ?? null,
        total_orders: Number((o as any).total_orders ?? 0),
        confirmed: Number((o as any).confirmed ?? 0),
        cod_total: codTotal,
        cod_confirmed: Number((o as any).cod_confirmed ?? 0),
        care_pct: codTotal > 0 ? +(spend / codTotal * 100).toFixed(2) : null,
        attribution_confidence: hasOrderMatch ? "ad_id" : "no_ad_order_match",
      }
    })

    return res.json({ rows, from, to, campaign_id, adset_id: adset_id || null, account_id: actId, fb_ok: fb.ok })
  } catch (err: any) {
    console.error("[ad-performance]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
