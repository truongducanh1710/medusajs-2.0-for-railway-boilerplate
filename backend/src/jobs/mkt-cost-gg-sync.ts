import { MedusaContainer } from "@medusajs/framework"

const GG_ADS_SHEET_URL = process.env.GG_ADS_SHEET_URL || ""
const GG_ADS_SHEET_TOKEN = process.env.GG_ADS_SHEET_TOKEN || ""

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

export default async function mktCostGgSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const cskhService = container.resolve("cskhAnalysisModule") as any

  if (!GG_ADS_SHEET_URL || !GG_ADS_SHEET_TOKEN) {
    logger?.warn?.("[MktCostGg] GG_ADS_SHEET_URL/GG_ADS_SHEET_TOKEN chưa cấu hình — bỏ qua")
    return
  }

  try {
    const url = `${GG_ADS_SHEET_URL}?token=${encodeURIComponent(GG_ADS_SHEET_TOKEN)}`
    const res = await fetch(url)
    const json: any = await res.json()

    if (!json.ok) {
      logger?.error?.(`[MktCostGg] API error: ${json.error ?? "unknown"}`)
      return
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
        INSERT INTO mkt_ads_cost_gg (date, impressions, clicks, ctr, avg_cpc, conversions, cost_per_conv, cost)
        VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (date) DO UPDATE SET
          impressions   = EXCLUDED.impressions,
          clicks        = EXCLUDED.clicks,
          ctr           = EXCLUDED.ctr,
          avg_cpc       = EXCLUDED.avg_cpc,
          conversions   = EXCLUDED.conversions,
          cost_per_conv = EXCLUDED.cost_per_conv,
          cost          = EXCLUDED.cost,
          updated_at    = now()
      `, [row.day, impressions, clicks, ctr, avgCpc, conversions, costPerConv, cost])

      synced++
    }

    logger?.info?.(`[MktCostGg] Xong — synced=${synced}/${rows.length}`)
  } catch (err: any) {
    logger?.error?.(`[MktCostGg] Error: ${err.message}`)
  }
}

export const config = {
  name: "mkt-cost-gg-sync",
  // 01:00 ICT (GMT+7) = 18:00 UTC ngày hôm trước
  schedule: "0 18 * * *",
}
