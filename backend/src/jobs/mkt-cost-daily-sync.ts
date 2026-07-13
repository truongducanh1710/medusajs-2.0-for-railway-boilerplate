import { MedusaContainer } from "@medusajs/framework"
import { extractMkt } from "../lib/mkt-code"

const FB_API_BASE = "https://graph.facebook.com/v25.0"

// Trả về "YYYY-MM-DD" theo giờ Việt Nam (UTC+7)
function dateVN(offsetDays = 0): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() + now.getTimezoneOffset() + 420) // +420 = +7h
  now.setDate(now.getDate() + offsetDays)
  return now.toISOString().slice(0, 10)
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  return res.json()
}

// Chạy các task với giới hạn concurrency để tránh rate-limit FB API
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function syncAccountForDate(
  cskhService: any,
  logger: any,
  FB_TOKEN: string,
  date: string,
  rawAccount: string
): Promise<{ synced: number; errors: number }> {
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))
  let totalSynced = 0
  let totalErrors = 0

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

    // Pull status + budget và UPSERT (kể cả camp spend=0 trong ngày đó)
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
  } catch (err: any) {
    logger?.error?.(`[MktCostDaily] Error account ${actId} date=${date}: ${err.message}`)
    totalErrors++
  }

  return { synced: totalSynced, errors: totalErrors }
}

export default async function mktCostDailySync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const cskhService = container.resolve("cskhAnalysisModule") as any

  const FB_TOKEN = process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
  if (!FB_TOKEN) {
    logger?.warn?.("[MktCostDaily] FB_SYSTEM_TOKEN/FB_ACCESS_TOKEN chưa cấu hình — bỏ qua")
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

  logger?.info?.(`[MktCostDaily] Bắt đầu sync ${dates.length} ngày x ${dbAccounts.length} accounts (concurrency=4)`)

  // Mỗi (ngày, account) là 1 task độc lập — chạy song song với giới hạn 4 để tránh rate-limit FB API
  const tasks: Array<{ date: string; account: string }> = []
  for (const date of dates) {
    for (const { account_id } of dbAccounts) {
      tasks.push({ date, account: account_id })
    }
  }

  const results = await mapWithConcurrency(tasks, 4, ({ date, account }) =>
    syncAccountForDate(cskhService, logger, FB_TOKEN, date, account)
  )

  const grandTotal = results.reduce((sum, r) => sum + r.synced, 0)
  const grandErrors = results.reduce((sum, r) => sum + r.errors, 0)

  logger?.info?.(`[MktCostDaily] Xong — tổng synced=${grandTotal} errors=${grandErrors}`)
}

export const config = {
  name: "mkt-cost-daily-sync",
  // 00:30 ICT (GMT+7) = 17:30 UTC ngày hôm trước
  schedule: "30 17 * * *",
}
