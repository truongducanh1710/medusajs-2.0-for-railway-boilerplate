/**
 * Backfill chi phí Facebook Ads — one-time historical pull.
 *
 * Usage:
 *   pnpm exec medusa exec ./src/scripts/backfill-mkt-cost.ts
 *   pnpm exec medusa exec ./src/scripts/backfill-mkt-cost.ts -- --from=2025-11-01 --to=2026-05-23
 *   pnpm exec medusa exec ./src/scripts/backfill-mkt-cost.ts -- --from=2025-11-01 --to=2026-05-23 --dry-run
 *
 * - Default: from = 6 tháng trước, to = hôm qua.
 * - Pull từng ngày một (FB Insights API yêu cầu time_range per-day để số chính xác).
 * - Upsert ON CONFLICT (date, campaign_id) → chạy lại an toàn.
 * - --dry-run: chỉ in ra sẽ sync những ngày nào, không ghi DB.
 */

import { ExecArgs } from "@medusajs/framework/types"

const FB_API_BASE = "https://graph.facebook.com/v18.0"
const DELAY_MS = 300 // tránh rate limit FB

function parseArg(name: string, fallback: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split("=")[1] : fallback
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = []
  let cur = from
  while (cur <= to) {
    dates.push(cur)
    cur = addDays(cur, 1)
  }
  return dates
}

function extractMkt(campaignName: string): string {
  const cleaned = campaignName.replace(/^(TEST_|MESS_)+/gi, "")
  const parts = cleaned.split("_")
  for (let i = 1; i < parts.length; i++) {
    const t = parts[i].trim()
    if (/^[A-Z]{3,8}$/.test(t)) return t
  }
  return "KHÁC"
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  return res.json()
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export default async function backfillMktCost({ container }: ExecArgs) {
  const logger = container.resolve("logger") as any
  const cskhService = container.resolve("cskhAnalysisModule") as any

  const FB_TOKEN = process.env.FB_ACCESS_TOKEN ?? ""
  if (!FB_TOKEN) {
    logger.error("[BackfillMktCost] FB_ACCESS_TOKEN chưa cấu hình — dừng")
    return
  }

  // Defaults: 6 tháng trước → hôm qua
  const defaultFrom = addDays(new Date().toISOString().slice(0, 10), -180)
  const defaultTo = addDays(new Date().toISOString().slice(0, 10), -1)

  const from = parseArg("from", defaultFrom)
  const to = parseArg("to", defaultTo)
  const dryRun = hasFlag("dry-run")

  const dates = dateRange(from, to)

  logger.info(`[BackfillMktCost] Bắt đầu backfill ${dates.length} ngày: ${from} → ${to}${dryRun ? " [DRY RUN]" : ""}`)

  if (dryRun) {
    logger.info(`[BackfillMktCost] Dry run — sẽ sync: ${dates.slice(0, 5).join(", ")}${dates.length > 5 ? ` ... +${dates.length - 5} ngày nữa` : ""}`)
    return
  }

  // Lấy danh sách ad accounts từ DB
  const dbAccounts: Array<{ account_id: string }> = await cskhService.sql(`
    SELECT account_id FROM fb_ad_account
    WHERE deleted_at IS NULL AND active = true
    ORDER BY created_at ASC
  `).catch(() => [])

  if (!dbAccounts.length) {
    logger.error("[BackfillMktCost] Chưa có FB ad account nào trong DB — vào Settings để thêm trước")
    return
  }

  logger.info(`[BackfillMktCost] Sử dụng ${dbAccounts.length} ad account(s)`)

  let grandSynced = 0
  let grandErrors = 0
  let grandSkipped = 0

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]
    const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))
    let daySynced = 0
    let dayErrors = 0

    for (const { account_id: rawAccount } of dbAccounts) {
      const actId = rawAccount.startsWith("act_") ? rawAccount : `act_${rawAccount}`
      const url = `${FB_API_BASE}/${actId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks&time_range=${timeRange}&limit=200&access_token=${FB_TOKEN}`

      try {
        let nextUrl: string | null = url
        while (nextUrl) {
          const data: any = await fetchJson(nextUrl)

          if (data.error) {
            logger.warn(`[BackfillMktCost] FB API error ${actId} date=${date}: ${data.error.message}`)
            dayErrors++
            break
          }

          const campaigns: any[] = data.data ?? []
          for (const c of campaigns) {
            const spend = Math.round(Number(c.spend ?? 0))
            if (spend <= 0) { grandSkipped++; continue }

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

            daySynced++
          }

          nextUrl = data.paging?.next ?? null
        }
      } catch (err: any) {
        logger.error(`[BackfillMktCost] Error account ${actId} date=${date}: ${err.message}`)
        dayErrors++
      }
    }

    grandSynced += daySynced
    grandErrors += dayErrors

    const progress = `[${i + 1}/${dates.length}]`
    if (daySynced > 0 || dayErrors > 0) {
      logger.info(`[BackfillMktCost] ${progress} ${date} → campaigns=${daySynced} errors=${dayErrors}`)
    } else {
      logger.info(`[BackfillMktCost] ${progress} ${date} → không có spend`)
    }

    if (i < dates.length - 1) await delay(DELAY_MS)
  }

  logger.info(`[BackfillMktCost] ✓ Hoàn thành — tổng campaigns=${grandSynced} skipped(spend=0)=${grandSkipped} errors=${grandErrors}`)
}
