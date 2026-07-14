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

        // Gom cả trang thành 1 câu upsert (unnest) thay vì 1 SQL/camp —
        // dedupe theo campaign_id vì ON CONFLICT không cho trùng trong cùng 1 câu
        const byId = new Map<string, any>()
        for (const c of (data.data ?? [])) {
          if (Math.round(Number(c.spend ?? 0)) > 0 && c.campaign_id) byId.set(String(c.campaign_id), c)
        }
        const rows = [...byId.values()]
        if (rows.length > 0) {
          await cskhService.sql(`
            INSERT INTO mkt_ads_cost (date, mkt_name, ad_account_id, campaign_id, campaign_name, spend, impressions, clicks)
            SELECT $1::date, u.mkt_name, $2, u.campaign_id, u.campaign_name, u.spend, u.impressions, u.clicks
            FROM unnest($3::text[], $4::text[], $5::text[], $6::bigint[], $7::bigint[], $8::bigint[])
              AS u(mkt_name, campaign_id, campaign_name, spend, impressions, clicks)
            ON CONFLICT (date, campaign_id) DO UPDATE SET
              spend = EXCLUDED.spend,
              impressions = EXCLUDED.impressions,
              clicks = EXCLUDED.clicks,
              mkt_name = EXCLUDED.mkt_name,
              updated_at = now()
          `, [
            today, actId,
            rows.map((c) => extractMkt(c.campaign_name ?? "")),
            rows.map((c) => String(c.campaign_id)),
            rows.map((c) => c.campaign_name ?? ""),
            rows.map((c) => Math.round(Number(c.spend ?? 0))),
            rows.map((c) => Number(c.impressions ?? 0)),
            rows.map((c) => Number(c.clicks ?? 0)),
          ])
          totalSynced += rows.length
        }

        nextUrl = data.paging?.next ?? null
      }

      // Pull meta: 2 bước tách biệt để giữ DB gọn
      // 1) ACTIVE: UPSERT cả batch — tạo row spend=0 nếu chưa có (camp bật nhưng chưa tiêu)
      // 2) PAUSED/khác: 1 câu UPDATE...FROM unnest — chỉ chạm row đã có hôm nay,
      //    camp cũ không có row tự động bị bỏ qua (trước đây mỗi camp 1 UPDATE rỗng vô ích)
      const metaUrl = `${FB_API_BASE}/${actId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget&limit=500&access_token=${FB_TOKEN}`
      try {
        let nextMeta: string | null = metaUrl
        while (nextMeta) {
          const metaData: any = await fetchJson(nextMeta)
          if (metaData.error) {
            logger?.warn?.(`[MktCostIntraday] Meta error ${actId}: ${metaData.error.message}`)
            break
          }
          const metaById = new Map<string, any>()
          for (const camp of (metaData.data ?? [])) {
            if (camp.id) metaById.set(String(camp.id), camp)
          }
          const camps = [...metaById.values()]
          const budgetOf = (camp: any) => {
            const budget = camp.daily_budget || camp.lifetime_budget
            return budget ? Math.round(Number(budget)) : null
          }

          const active = camps.filter((c) => c.status === "ACTIVE")
          if (active.length > 0) {
            await cskhService.sql(`
              INSERT INTO mkt_ads_cost
                (date, mkt_name, ad_account_id, campaign_id, campaign_name, spend, impressions, clicks, effective_status, daily_budget)
              SELECT $1::date, u.mkt_name, $2, u.campaign_id, u.campaign_name, 0, 0, 0, u.status, u.daily_budget
              FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[])
                AS u(mkt_name, campaign_id, campaign_name, status, daily_budget)
              ON CONFLICT (date, campaign_id) DO UPDATE SET
                effective_status = EXCLUDED.effective_status,
                daily_budget     = EXCLUDED.daily_budget,
                updated_at       = now()
            `, [
              today, actId,
              active.map((c) => extractMkt(c.name ?? "")),
              active.map((c) => String(c.id)),
              active.map((c) => c.name ?? ""),
              active.map((c) => c.status),
              active.map(budgetOf),
            ])
          }

          const inactive = camps.filter((c) => c.status !== "ACTIVE")
          if (inactive.length > 0) {
            await cskhService.sql(`
              UPDATE mkt_ads_cost m
              SET effective_status = u.status, daily_budget = u.daily_budget, updated_at = now()
              FROM unnest($2::text[], $3::text[], $4::bigint[]) AS u(campaign_id, status, daily_budget)
              WHERE m.campaign_id = u.campaign_id AND m.date = $1::date
            `, [
              today,
              inactive.map((c) => String(c.id)),
              inactive.map((c) => c.status ?? null),
              inactive.map(budgetOf),
            ])
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
