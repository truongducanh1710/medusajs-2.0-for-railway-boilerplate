import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const FB_API_BASE = "https://graph.facebook.com/v18.0"
const FB_TOKEN = process.env.FB_ACCESS_TOKEN ?? ""

/**
 * Extract MKT code từ campaign name.
 * Hỗ trợ 2 format delimiter: _ và -
 * Format: DD/MM_MKTCODE_SẢN PHẨM_... hoặc DD/MM-MKTCODE-SẢN PHẨM-...
 * Bỏ prefix: TEST_, MESS_, TEST_MESS_
 */
function extractMkt(campaignName: string): string {
  // Bỏ prefix TEST_ / MESS_ lặp lại
  const cleaned = campaignName.replace(/^(TEST[_-]|MESS[_-])+/gi, "")
  // Thử split theo _ trước, nếu không ra thì thử -
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

/**
 * GET /admin/pancake-sync/report/mkt-cost?from=2026-05-01&to=2026-05-31
 * Trả spend đã sync từ DB, group by date + mkt_name
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
    } = req.query as Record<string, string>

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

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
      GROUP BY date, mkt_name
      ORDER BY date DESC, spend DESC
    `, [from, to])

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
