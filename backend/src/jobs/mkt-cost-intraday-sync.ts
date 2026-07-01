import { MedusaContainer } from "@medusajs/framework"
import { extractMkt } from "../lib/mkt-code"

const FB_API_BASE = "https://graph.facebook.com/v25.0"

// Trả về "YYYY-MM-DD" theo giờ Việt Nam (UTC+7)
function todayVN(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() + now.getTimezoneOffset() + 420) // +420 = +7h
  return now.toISOString().slice(0, 10)
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  return res.json()
}

export default async function mktCostIntradaySync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const cskhService = container.resolve("cskhAnalysisModule") as any

  const FB_TOKEN = process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
  if (!FB_TOKEN) {
    logger?.warn?.("[MktCostIntraday] FB_SYSTEM_TOKEN/FB_ACCESS_TOKEN chưa cấu hình — bỏ qua")
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

      // Pull meta: 2 bước tách biệt để giữ DB gọn
      // 1) UPDATE status/budget cho camps đã có row hôm nay (từ insights)
      // 2) UPSERT chỉ camps đang ACTIVE mà chưa có row (spend=0 nhưng đang chạy)
      const metaUrl = `${FB_API_BASE}/${actId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget&limit=500&access_token=${FB_TOKEN}`
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

            if (camp.status === "ACTIVE") {
              // ACTIVE: UPSERT — tạo row spend=0 nếu chưa có (camp bật nhưng chưa tiêu)
              await cskhService.sql(`
                INSERT INTO mkt_ads_cost
                  (date, mkt_name, ad_account_id, campaign_id, campaign_name, spend, impressions, clicks, effective_status, daily_budget)
                VALUES ($1::date, $2, $3, $4, $5, 0, 0, 0, $6, $7)
                ON CONFLICT (date, campaign_id) DO UPDATE SET
                  effective_status = EXCLUDED.effective_status,
                  daily_budget     = EXCLUDED.daily_budget,
                  updated_at       = now()
              `, [today, mktName, actId, camp.id, camp.name ?? "", camp.status, budgetValue])
            } else {
              // PAUSED/khác: chỉ UPDATE nếu đã có row — không tạo row mới
              await cskhService.sql(`
                UPDATE mkt_ads_cost
                SET effective_status = $1, daily_budget = $2, updated_at = now()
                WHERE campaign_id = $3 AND date = $4::date
              `, [camp.status ?? null, budgetValue, camp.id, today])
            }
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
  schedule: "2-59/5 * * * *",
}
