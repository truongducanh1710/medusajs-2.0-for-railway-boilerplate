import { MedusaContainer } from "@medusajs/framework"

const FB_API_BASE = "https://graph.facebook.com/v18.0"

// Trả về "YYYY-MM-DD" theo giờ Việt Nam (UTC+7)
function dateVN(offsetDays = 0): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() + now.getTimezoneOffset() + 420) // +420 = +7h
  now.setDate(now.getDate() + offsetDays)
  return now.toISOString().slice(0, 10)
}

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

async function syncDate(
  cskhService: any,
  logger: any,
  FB_TOKEN: string,
  date: string,
  dbAccounts: Array<{ account_id: string }>
): Promise<{ synced: number; errors: number }> {
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))
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
          logger?.error?.(`[MktCostDaily] FB API error ${actId} date=${date}: ${data.error.message}`)
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

          totalSynced++
        }

        nextUrl = data.paging?.next ?? null
      }
    } catch (err: any) {
      logger?.error?.(`[MktCostDaily] Error account ${actId} date=${date}: ${err.message}`)
      totalErrors++
    }
  }

  return { synced: totalSynced, errors: totalErrors }
}

export default async function mktCostDailySync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const cskhService = container.resolve("cskhAnalysisModule") as any

  const FB_TOKEN = process.env.FB_ACCESS_TOKEN ?? ""
  if (!FB_TOKEN) {
    logger?.warn?.("[MktCostDaily] FB_ACCESS_TOKEN chưa cấu hình — bỏ qua")
    return
  }

  const dbAccounts = await cskhService.sql(`
    SELECT account_id FROM fb_ad_account
    WHERE deleted_at IS NULL AND active = true
    ORDER BY created_at ASC
  `).catch(() => [])

  if (!dbAccounts.length) {
    logger?.warn?.("[MktCostDaily] Không có FB ad account nào active")
    return
  }

  // Pull 3 ngày gần nhất: hôm qua + hôm kia + 3 ngày trước
  // FB thường finalize số liệu sau 1-2 ngày nên cần re-sync lại
  const dates: string[] = []
  for (let i = 1; i <= 3; i++) {
    dates.push(dateVN(-i))
  }

  logger?.info?.(`[MktCostDaily] Bắt đầu sync ${dates.length} ngày: ${dates.join(", ")}`)

  let grandTotal = 0
  let grandErrors = 0
  for (const date of dates) {
    const { synced, errors } = await syncDate(cskhService, logger, FB_TOKEN, date, dbAccounts)
    logger?.info?.(`[MktCostDaily] ${date} → synced=${synced} errors=${errors}`)
    grandTotal += synced
    grandErrors += errors
  }

  logger?.info?.(`[MktCostDaily] Xong — tổng synced=${grandTotal} errors=${grandErrors}`)
}

export const config = {
  name: "mkt-cost-daily-sync",
  // 00:30 ICT (GMT+7) = 17:30 UTC ngày hôm trước
  schedule: "30 17 * * *",
}
