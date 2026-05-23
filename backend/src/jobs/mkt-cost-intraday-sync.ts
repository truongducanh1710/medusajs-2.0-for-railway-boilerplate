import { MedusaContainer } from "@medusajs/framework"

const FB_API_BASE = "https://graph.facebook.com/v18.0"

function extractMkt(campaignName: string): string {
  const cleaned = campaignName.replace(/^(TEST[_-]|MESS[_-])+/gi, "")
  for (const sep of ["_", "-"]) {
    const parts = cleaned.split(sep)
    for (let i = 1; i < parts.length; i++) {
      const t = parts[i].trim()
      if (/^[A-Z]{3,8}$/.test(t)) return t
    }
  }
  return "KHÁC"
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  return res.json()
}

export default async function mktCostIntradaySync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const cskhService = container.resolve("cskhAnalysisModule") as any

  const FB_TOKEN = process.env.FB_ACCESS_TOKEN ?? ""
  if (!FB_TOKEN) {
    logger?.warn?.("[MktCostIntraday] FB_ACCESS_TOKEN chưa cấu hình — bỏ qua")
    return
  }

  const today = new Date().toISOString().slice(0, 10)
  const timeRange = encodeURIComponent(JSON.stringify({ since: today, until: today }))

  const dbAccounts = await cskhService.sql(`
    SELECT account_id FROM fb_ad_account
    WHERE deleted_at IS NULL AND active = true
    ORDER BY created_at ASC
  `).catch(() => [])

  if (!dbAccounts.length) {
    logger?.warn?.("[MktCostIntraday] Không có FB ad account nào active")
    return
  }

  let totalSynced = 0
  let totalErrors = 0

  for (const { account_id: rawAccount } of dbAccounts) {
    const actId = rawAccount.startsWith("act_") ? rawAccount : `act_${rawAccount}`
    const url = `${FB_API_BASE}/${actId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks&time_range=${timeRange}&limit=200&access_token=${FB_TOKEN}`

    try {
      let nextUrl: string | null = url
      while (nextUrl) {
        const data: any = await fetchJson(nextUrl)
        if (data.error) {
          logger?.error?.(`[MktCostIntraday] FB API error ${actId}: ${data.error.message}`)
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
          `, [today, mktName, actId, c.campaign_id, c.campaign_name, spend, impressions, clicks])

          totalSynced++
        }

        nextUrl = data.paging?.next ?? null
      }
    } catch (err: any) {
      logger?.error?.(`[MktCostIntraday] Error account ${actId}: ${err.message}`)
      totalErrors++
    }
  }

  logger?.info?.(`[MktCostIntraday] ${today} → synced=${totalSynced} errors=${totalErrors}`)
}

export const config = {
  name: "mkt-cost-intraday-sync",
  schedule: "*/5 * * * *",
}
