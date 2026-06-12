import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { extractMkt } from "../../../../../lib/mkt-code"

const FB_API_BASE = "https://graph.facebook.com/v25.0"
const FB_TOKEN = process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  return res.json()
}

/**
 * GET /admin/pancake-sync/report/mkt-cost?from=2026-05-01&to=2026-05-31
 * Trả spend đã sync từ DB, group by date + mkt_name
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      mkt_code,
      account_id,
    } = req.query as Record<string, string>

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    const params: any[] = [from, to]
    const filters: string[] = []
    if (mkt_code) {
      params.push(mkt_code)
      filters.push(`mkt_name = $${params.length}`)
    }
    if (account_id) {
      params.push(account_id.startsWith("act_") ? account_id : `act_${account_id}`)
      filters.push(`ad_account_id = $${params.length}`)
    }

    const rows = await cskhService.sql(`
      SELECT
        date::text AS date,
        mkt_name,
        SUM(spend)::bigint AS spend,
        SUM(impressions)::int AS impressions,
        SUM(clicks)::int AS clicks,
        COUNT(DISTINCT campaign_id)::int AS campaigns
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL
        AND date >= $1::date
        AND date <= $2::date
        ${filters.length ? "AND " + filters.join(" AND ") : ""}
      GROUP BY date, mkt_name
      ORDER BY date DESC, spend DESC
    `, params)

    const summary: Record<string, any> = {}
    for (const row of rows) {
      const m = row.mkt_name
      if (!summary[m]) summary[m] = { spend: 0, impressions: 0, clicks: 0 }
      summary[m].spend += Number(row.spend)
      summary[m].impressions += Number(row.impressions)
      summary[m].clicks += Number(row.clicks)
    }

    return res.json({ rows, summary, from, to })
  } catch (err: any) {
    console.error("[mkt-cost GET]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/pancake-sync/report/mkt-cost
 * Body: { "date": "2026-05-23" }  // optional, default hôm nay
 * Trigger pull spend từ FB API → upsert vào mkt_ads_cost
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (!FB_TOKEN) return res.status(400).json({ error: "FB_ACCESS_TOKEN chưa được cấu hình trong Railway env" })

    const body = req.body as any
    const date = (body?.date as string) || new Date().toISOString().slice(0, 10)
    const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    // Lấy danh sách accounts từ DB
    const dbAccounts = await cskhService.sql(`
      SELECT account_id FROM fb_ad_account
      WHERE deleted_at IS NULL AND active = true
      ORDER BY created_at ASC
    `)
    if (!dbAccounts.length) return res.status(400).json({ error: "Chưa có tài khoản FB Ads nào. Vào Settings để thêm." })

    let totalSynced = 0
    let totalErrors = 0
    const perMkt: Record<string, number> = {}
    const details: any[] = []

    for (const { account_id: rawAccount } of dbAccounts) {
      const actId = rawAccount.startsWith("act_") ? rawAccount : `act_${rawAccount.replace(/^act_/, "")}`
      const url = `${FB_API_BASE}/${actId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks&time_range=${timeRange}&limit=200&access_token=${FB_TOKEN}`

      try {
        let nextUrl: string | null = url
        while (nextUrl) {
          const data: any = await fetchJson(nextUrl)

          if (data.error) {
            console.error(`[mkt-cost] FB API error ${actId}:`, data.error.message)
            totalErrors++
            break
          }

          const campaigns: any[] = data.data ?? []
          for (const c of campaigns) {
            const spend = Math.round(Number(c.spend ?? 0))
            if (spend <= 0) continue

            const mktName = extractMkt(c.campaign_name ?? "")
            const impressions = Number(c.impressions ?? 0)
            const clicks = Number(c.clicks ?? 0)

            await cskhService.sql(`
              INSERT INTO mkt_ads_cost (date, mkt_name, ad_account_id, campaign_id, campaign_name, spend, impressions, clicks)
              VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (date, campaign_id) DO UPDATE SET
                spend = EXCLUDED.spend,
                impressions = EXCLUDED.impressions,
                clicks = EXCLUDED.clicks,
                mkt_name = EXCLUDED.mkt_name,
                updated_at = now()
            `, [date, mktName, actId, c.campaign_id, c.campaign_name, spend, impressions, clicks])

            perMkt[mktName] = (perMkt[mktName] ?? 0) + spend
            totalSynced++
            details.push({ account: actId, campaign: c.campaign_name, mkt: mktName, spend })
          }

          nextUrl = data.paging?.next ?? null
        }

        // Pull meta: UPSERT chỉ ACTIVE (spend=0 nhưng đang chạy), UPDATE-only cho PAUSED
        const metaUrl = `${FB_API_BASE}/${actId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget&limit=500&access_token=${FB_TOKEN}`
        let nextMeta: string | null = metaUrl
        while (nextMeta) {
          const metaData: any = await fetchJson(nextMeta)
          if (metaData.error) break
          for (const camp of (metaData.data ?? [])) {
            const budget = camp.daily_budget || camp.lifetime_budget
            const budgetValue = budget ? Math.round(Number(budget)) : null
            const mktName = extractMkt(camp.name ?? "")
            if (camp.status === "ACTIVE") {
              await cskhService.sql(`
                INSERT INTO mkt_ads_cost
                  (date, mkt_name, ad_account_id, campaign_id, campaign_name, spend, impressions, clicks, effective_status, daily_budget)
                VALUES ($1::date, $2, $3, $4, $5, 0, 0, 0, $6, $7)
                ON CONFLICT (date, campaign_id) DO UPDATE SET
                  effective_status = EXCLUDED.effective_status,
                  daily_budget     = EXCLUDED.daily_budget,
                  updated_at       = now()
              `, [date, mktName, actId, camp.id, camp.name ?? "", camp.status, budgetValue])
            } else {
              await cskhService.sql(`
                UPDATE mkt_ads_cost
                SET effective_status = $1, daily_budget = $2, updated_at = now()
                WHERE campaign_id = $3 AND date = $4::date
              `, [camp.status ?? null, budgetValue, camp.id, date])
            }
          }
          nextMeta = metaData.paging?.next ?? null
        }
      } catch (accErr: any) {
        console.error(`[mkt-cost] Error account ${actId}:`, accErr.message)
        totalErrors++
      }
    }

    console.log(`[mkt-cost] Synced ${totalSynced} campaigns for ${date}, errors: ${totalErrors}`)
    return res.json({ ok: true, date, synced: totalSynced, errors: totalErrors, per_mkt: perMkt })
  } catch (err: any) {
    console.error("[mkt-cost POST]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
