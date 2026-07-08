import { MedusaContainer } from "@medusajs/framework"

// Parse số kiểu VN từ Apps Script: "." = phân cách nghìn, "," = phân cách thập phân
// vd: "29.757" -> 29757 | "2,58%" -> 2.58 | "$1.824,90" -> 1824.9
function parseVnNumber(raw: string | undefined): number {
  if (!raw) return 0
  const cleaned = raw.replace(/[^0-9.,-]/g, "")
  if (!cleaned) return 0
  const normalized = cleaned.replace(/\./g, "").replace(",", ".")
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

interface GgAdsRow {
  day: string
  impr: string
  clicks: string
  ctr: string
  avg_cpc: string
  conversions: string
  cost__per__conv: string
  cost: string
}

interface GgAdsSource {
  mktName: string
  url: string
  token: string
}

export default async function mktCostGgSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const cskhService = container.resolve("cskhAnalysisModule") as any

  // Mỗi marketer gắn 1 sheet Google Ads riêng — cấu hình qua Settings > Users
  // (metadata.mkt_code + metadata.gg_ads_sheet_url + metadata.gg_ads_sheet_token)
  const users = await cskhService.sql(`
    SELECT
      metadata->>'mkt_code' AS mkt_code,
      metadata->>'gg_ads_sheet_url' AS sheet_url,
      metadata->>'gg_ads_sheet_token' AS sheet_token
    FROM "user"
    WHERE deleted_at IS NULL
      AND metadata->>'mkt_code' IS NOT NULL
      AND metadata->>'gg_ads_sheet_url' IS NOT NULL
      AND metadata->>'gg_ads_sheet_token' IS NOT NULL
  `).catch(() => [])

  const sources: GgAdsSource[] = users
    .filter((u: any) => u.mkt_code && u.sheet_url && u.sheet_token)
    .map((u: any) => ({ mktName: String(u.mkt_code).toUpperCase(), url: u.sheet_url, token: u.sheet_token }))

  if (!sources.length) {
    logger?.warn?.("[MktCostGg] Không có user nào cấu hình gg_ads_sheet_url — bỏ qua")
    return
  }

  let grandSynced = 0
  for (const src of sources) {
    try {
      const url = `${src.url}?token=${encodeURIComponent(src.token)}`
      const res = await fetch(url)
      const json: any = await res.json()

      if (!json.ok) {
        logger?.error?.(`[MktCostGg] ${src.mktName} API error: ${json.error ?? "unknown"}`)
        continue
      }

      const rows: GgAdsRow[] = json.data ?? []
      let synced = 0

      for (const row of rows) {
        if (!row.day) continue

        const impressions = Math.round(parseVnNumber(row.impr))
        const clicks = Math.round(parseVnNumber(row.clicks))
        const ctr = parseVnNumber(row.ctr)
        const avgCpc = Math.round(parseVnNumber(row.avg_cpc))
        const conversions = parseVnNumber(row.conversions)
        const costPerConv = Math.round(parseVnNumber(row.cost__per__conv))
        const cost = Math.round(parseVnNumber(row.cost))

        await cskhService.sql(`
          INSERT INTO mkt_ads_cost_gg (date, mkt_name, impressions, clicks, ctr, avg_cpc, conversions, cost_per_conv, cost)
          VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (date, mkt_name) DO UPDATE SET
            impressions   = EXCLUDED.impressions,
            clicks        = EXCLUDED.clicks,
            ctr           = EXCLUDED.ctr,
            avg_cpc       = EXCLUDED.avg_cpc,
            conversions   = EXCLUDED.conversions,
            cost_per_conv = EXCLUDED.cost_per_conv,
            cost          = EXCLUDED.cost,
            updated_at    = now()
        `, [row.day, src.mktName, impressions, clicks, ctr, avgCpc, conversions, costPerConv, cost])

        synced++
      }

      logger?.info?.(`[MktCostGg] ${src.mktName} → synced=${synced}/${rows.length}`)
      grandSynced += synced
    } catch (err: any) {
      logger?.error?.(`[MktCostGg] ${src.mktName} Error: ${err.message}`)
    }
  }

  logger?.info?.(`[MktCostGg] Xong — ${sources.length} nguồn, tổng synced=${grandSynced}`)
}

export const config = {
  name: "mkt-cost-gg-sync",
  // 01:00 ICT (GMT+7) = 18:00 UTC ngày hôm trước
  schedule: "0 18 * * *",
}
