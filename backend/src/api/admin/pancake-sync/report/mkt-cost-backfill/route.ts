import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const FB_API_BASE = "https://graph.facebook.com/v18.0"
const DELAY_MS = 300

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
  const FB_TOKEN = process.env.FB_ACCESS_TOKEN ?? ""
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

  const dates = dateRange(from, to)

  console.log(`[Backfill] Bắt đầu ${dates.length} ngày: ${from} → ${to}, ${dbAccounts.length} accounts`)

  // Chạy async, trả response ngay để không timeout
  res.json({
    ok: true,
    message: `Đang chạy backfill ${dates.length} ngày (${from} → ${to}). Theo dõi trong Railway logs.`,
    days: dates.length,
    accounts: dbAccounts.length,
    from,
    to,
  })

  // Fire and forget
  ;(async () => {
    let grandSynced = 0
    let grandErrors = 0

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]
      const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))
      let daySynced = 0

      for (const { account_id: rawAccount } of dbAccounts) {
        const actId = rawAccount.startsWith("act_") ? rawAccount : `act_${rawAccount}`
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
        } catch (err: any) {
          console.error(`[Backfill] Error ${actId} ${date}: ${err.message}`)
          grandErrors++
        }
      }

      grandSynced += daySynced
      console.log(`[Backfill] [${i + 1}/${dates.length}] ${date} → campaigns=${daySynced}`)
      if (i < dates.length - 1) await delay(DELAY_MS)
    }

    console.log(`[Backfill] ✓ Xong — tổng campaigns=${grandSynced} errors=${grandErrors}`)
  })()
}
