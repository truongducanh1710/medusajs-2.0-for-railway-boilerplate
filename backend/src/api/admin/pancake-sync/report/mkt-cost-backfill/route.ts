import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { extractMkt } from "../../../../../lib/mkt-code"

const FB_API_BASE = "https://graph.facebook.com/v25.0"
const DELAY_MS = 300

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  return res.json()
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
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

/**
 * POST /admin/pancake-sync/report/mkt-cost-backfill
 * Body: { "from": "2025-11-23", "to": "2026-05-22" }
 * Chạy backfill chi phí FB Ads cho khoảng thời gian chỉ định.
 * Streaming response — log từng ngày để theo dõi progress.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const FB_TOKEN = process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""
  if (!FB_TOKEN) return res.status(400).json({ error: "FB_ACCESS_TOKEN chưa cấu hình" })

  const body = req.body as any
  const defaultFrom = addDays(new Date().toISOString().slice(0, 10), -180)
  const defaultTo = addDays(new Date().toISOString().slice(0, 10), -1)
  const from = (body?.from as string) || defaultFrom
  const to = (body?.to as string) || defaultTo

  const cskhService = req.scope.resolve("cskhAnalysisModule") as any

  const dbAccounts: Array<{ account_id: string }> = await cskhService.sql(`
    SELECT account_id FROM fb_ad_account
    WHERE deleted_at IS NULL AND active = true
    ORDER BY created_at ASC
  `).catch(() => [])

  if (!dbAccounts.length) return res.status(400).json({ error: "Chưa có FB ad account nào active" })

  // Kéo từ ngày mới nhất về cũ — nếu bị ngắt giữa chừng thì data gần nhất đã có
  const dates = dateRange(from, to).reverse()
  const accountIds = dbAccounts.map(a => a.account_id.startsWith("act_") ? a.account_id : `act_${a.account_id}`)

  // Lấy danh sách (date, account_id) đã có đủ data — skip để không kéo lại
  const donePairs: Set<string> = new Set()
  try {
    const doneRows: Array<{ date: string; ad_account_id: string }> = await cskhService.sql(`
      SELECT DISTINCT date::text AS date, ad_account_id
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL
        AND date >= $1::date AND date <= $2::date
        AND ad_account_id = ANY($3)
    `, [from, to, accountIds])
    for (const r of doneRows) {
      donePairs.add(`${r.date.slice(0, 10)}|${r.ad_account_id}`)
    }
  } catch { /* ignore */ }

  const totalPairs = dates.length * accountIds.length
  const skipCount = donePairs.size
  console.log(`[Backfill] ${dates.length} ngày × ${accountIds.length} accounts = ${totalPairs} pairs, đã có: ${skipCount}, cần kéo: ${totalPairs - skipCount}`)

  // Chạy async, trả response ngay để không timeout
  res.json({
    ok: true,
    message: `Đang chạy backfill ${dates.length} ngày (${from} → ${to}). Đã có: ${skipCount}/${totalPairs} pairs, bỏ qua. Theo dõi Railway logs.`,
    days: dates.length,
    accounts: accountIds.length,
    total_pairs: totalPairs,
    already_done: skipCount,
    from,
    to,
  })

  // Fire and forget
  ;(async () => {
    let grandSynced = 0
    let grandErrors = 0
    let grandSkipped = 0

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]
      const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))
      let daySynced = 0

      for (const actId of accountIds) {
        // Skip nếu đã có data của account này cho ngày này
        if (donePairs.has(`${date}|${actId}`)) {
          grandSkipped++
          continue
        }

        const url = `${FB_API_BASE}/${actId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks&time_range=${timeRange}&limit=500&access_token=${FB_TOKEN}`

        try {
          let nextUrl: string | null = url
          while (nextUrl) {
            const data: any = await fetchJson(nextUrl)
            if (data.error) {
              console.error(`[Backfill] FB error ${actId} ${date}: ${data.error.message}`)
              grandErrors++
              break
            }
            for (const c of (data.data ?? [])) {
              const spend = Math.round(Number(c.spend ?? 0))
              if (spend <= 0) continue
              const mktName = extractMkt(c.campaign_name ?? "")
              await cskhService.sql(`
                INSERT INTO mkt_ads_cost (date, mkt_name, ad_account_id, campaign_id, campaign_name, spend, impressions, clicks)
                VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (date, campaign_id) DO UPDATE SET
                  spend = EXCLUDED.spend, impressions = EXCLUDED.impressions,
                  clicks = EXCLUDED.clicks, mkt_name = EXCLUDED.mkt_name, updated_at = now()
              `, [date, mktName, actId, c.campaign_id, c.campaign_name, spend,
                  Number(c.impressions ?? 0), Number(c.clicks ?? 0)])
              daySynced++
            }
            nextUrl = data.paging?.next ?? null
          }
          // Đánh dấu đã kéo xong account này cho ngày này
          donePairs.add(`${date}|${actId}`)
        } catch (err: any) {
          console.error(`[Backfill] Error ${actId} ${date}: ${err.message}`)
          grandErrors++
        }
      }

      grandSynced += daySynced
      if (daySynced > 0) {
        console.log(`[Backfill] [${i + 1}/${dates.length}] ${date} → campaigns=${daySynced}`)
      }
      if (i < dates.length - 1) await delay(DELAY_MS)
    }

    console.log(`[Backfill] ✓ Xong — synced=${grandSynced} skipped=${grandSkipped} errors=${grandErrors}`)
  })()
}
