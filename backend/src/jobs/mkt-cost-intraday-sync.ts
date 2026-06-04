import { MedusaContainer } from "@medusajs/framework"

const FB_API_BASE = "https://graph.facebook.com/v18.0"

// Trả về "YYYY-MM-DD" theo giờ Việt Nam (UTC+7)
function todayVN(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() + now.getTimezoneOffset() + 420) // +420 = +7h
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

export default async function mktCostIntradaySync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const cskhService = container.resolve("cskhAnalysisModule") as any

  const FB_TOKEN = process.env.FB_ACCESS_TOKEN ?? ""
  if (!FB_TOKEN) {
    logger?.warn?.("[MktCostIntraday] FB_ACCESS_TOKEN chưa cấu hình — bỏ qua")
    return
  }

  const today = todayVN()
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

      // Pull meta (status + budget) cho TẤT CẢ camps của account — kể cả camp chưa tiêu tiền hôm nay.
      // Dùng UPSERT: INSERT nếu chưa có row hôm nay (camp spend=0 vẫn được ghi status),
      //              UPDATE nếu đã có (từ insights pull ở trên).
      // Dùng `status` (config) thay vì `effective_status` để khớp UI Ads Manager.
      const metaUrl = `${FB_API_BASE}/${actId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget&limit=200&access_token=${FB_TOKEN}`
      try {
        let nextMeta: string | null = metaUrl
        while (nextMeta) {
          const metaData: any = await fetchJson(nextMeta)
          if (metaData.error) {
            logger?.warn?.(`[MktCostIntraday] Meta error ${actId}: ${metaData.error.message}`)
            break
          }
          for (const camp of (metaData.data ?? [])) {
            const budget = camp.daily_budget || camp.lifetime_budget
            const budgetValue = budget ? Math.round(Number(budget)) : null
            const mktName = extractMkt(camp.name ?? "")
            // UPSERT: tạo row với spend=0 nếu chưa có — để status hiển thị đúng trên UI
            await cskhService.sql(`
              INSERT INTO mkt_ads_cost
                (date, mkt_name, ad_account_id, campaign_id, campaign_name, spend, impressions, clicks, effective_status, daily_budget)
              VALUES ($1::date, $2, $3, $4, $5, 0, 0, 0, $6, $7)
              ON CONFLICT (date, campaign_id) DO UPDATE SET
                effective_status = EXCLUDED.effective_status,
                daily_budget     = EXCLUDED.daily_budget,
                updated_at       = now()
            `, [today, mktName, actId, camp.id, camp.name ?? "", camp.status ?? null, budgetValue])
          }
          nextMeta = metaData.paging?.next ?? null
        }
      } catch (metaErr: any) {
        logger?.warn?.(`[MktCostIntraday] Meta fetch failed ${actId}: ${metaErr.message}`)
      }
      // Update account_name nếu chưa có
      try {
        const [dbAcc] = await cskhService.sql(`SELECT account_name FROM fb_ad_account WHERE account_id = $1`, [actId])
        if (dbAcc && !dbAcc.account_name) {
          const accInfo: any = await fetchJson(`${FB_API_BASE}/${actId}?fields=name&access_token=${FB_TOKEN}`)
          if (accInfo.name) {
            await cskhService.sql(`UPDATE fb_ad_account SET account_name = $1, updated_at = now() WHERE account_id = $2`, [accInfo.name, actId])
          }
        }
      } catch { /* ignore — tên account không critical */ }
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
