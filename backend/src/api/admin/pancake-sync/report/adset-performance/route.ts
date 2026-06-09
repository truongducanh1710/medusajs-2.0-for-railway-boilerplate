import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { callFbApi } from "../camp-control/_lib"

const adsetExpr = `COALESCE(raw->>'p_adset_id', raw->>'adset_id', raw->>'utm_adset_id', raw->>'p_utm_adset_id', raw->'marketing'->>'adset_id')`

async function campaignAccount(sql: any, campaignId: string): Promise<string | null> {
  const rows = await sql.sql(`SELECT ad_account_id FROM mkt_ads_cost WHERE campaign_id = $1 ORDER BY date DESC LIMIT 1`, [campaignId]).catch(() => [])
  return rows[0]?.ad_account_id ?? null
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { campaign_id, account_id, from, to } = req.query as Record<string, string>
    if (!campaign_id || !from || !to) return res.status(400).json({ error: "campaign_id, from, to are required" })
    const sql = req.scope.resolve("cskhAnalysisModule") as any
    const actId = account_id || await campaignAccount(sql, campaign_id)
    if (!actId) return res.status(404).json({ error: "Cannot infer account_id for campaign" })

    const timeRange = encodeURIComponent(JSON.stringify({ since: from, until: to }))
    const fb = await callFbApi("GET", `/${actId}/insights?level=adset&fields=campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,ctr,cpm&time_range=${timeRange}&filtering=[{"field":"campaign.id","operator":"EQUAL","value":"${campaign_id}"}]&limit=200`)
    const insights = fb.data?.data ?? []

    const orders = await sql.sql(`
      SELECT
        ${adsetExpr} AS adset_id,
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE status IN (1,2,3,4,5))::int AS confirmed,
        SUM(CASE WHEN status NOT IN (-2,7) THEN cod_amount ELSE 0 END)::bigint AS cod_total,
        SUM(CASE WHEN status IN (1,2,3,4,5) THEN cod_amount ELSE 0 END)::bigint AS cod_confirmed
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND fb_campaign_id = $3
      GROUP BY ${adsetExpr}
    `, [from, to, campaign_id]).catch(() => [])
    const orderMap = new Map(orders.map((o: any) => [o.adset_id, o]))

    const rows = insights.map((r: any) => {
      const hasOrderMatch = orderMap.has(r.adset_id)
      const o = orderMap.get(r.adset_id) ?? {}
      const spend = Math.round(Number(r.spend ?? 0))
      const codTotal = Number((o as any).cod_total ?? 0)
      return {
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        adset_id: r.adset_id,
        adset_name: r.adset_name,
        spend,
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        ctr_pct: Number(r.ctr ?? 0),
        cpm: Math.round(Number(r.cpm ?? 0)),
        total_orders: Number((o as any).total_orders ?? 0),
        confirmed: Number((o as any).confirmed ?? 0),
        cod_total: codTotal,
        cod_confirmed: Number((o as any).cod_confirmed ?? 0),
        care_pct: codTotal > 0 ? +(spend / codTotal * 100).toFixed(2) : null,
        attribution_confidence: hasOrderMatch ? "adset_id" : "no_adset_order_match",
      }
    })

    return res.json({ rows, from, to, campaign_id, account_id: actId, fb_ok: fb.ok })
  } catch (err: any) {
    console.error("[adset-performance]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
