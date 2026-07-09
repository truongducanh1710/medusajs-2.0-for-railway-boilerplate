import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Parse số kiểu VN từ Apps Script: "." = phân cách nghìn, "," = phân cách thập phân
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

/**
 * GET /admin/pancake-sync/report/mkt-cost-gg?from=2026-05-01&to=2026-05-31
 * Trả spend Google Ads đã sync từ DB, group by date + mkt_name
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      mkt_code,
    } = req.query as Record<string, string>

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    const params: any[] = [from, to]
    const filters: string[] = []
    if (mkt_code) {
      params.push(mkt_code)
      filters.push(`mkt_name = $${params.length}`)
    }

    const rows = await cskhService.sql(`
      SELECT date::text AS date, mkt_name, cost::bigint AS cost, impressions, clicks, conversions
      FROM mkt_ads_cost_gg
      WHERE deleted_at IS NULL
        AND date >= $1::date
        AND date <= $2::date
        ${filters.length ? "AND " + filters.join(" AND ") : ""}
      ORDER BY date DESC
    `, params)

    return res.json({ rows, from, to })
  } catch (err: any) {
    console.error("[mkt-cost-gg GET]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/pancake-sync/report/mkt-cost-gg
 * Trigger pull chi phí Google Ads từ sheet của mỗi marketer (metadata.gg_ads_sheet_url)
 * → upsert vào mkt_ads_cost_gg. Dùng chung logic với job mkt-cost-gg-sync.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

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
    `)

    const sources = users
      .filter((u: any) => u.mkt_code && u.sheet_url && u.sheet_token)
      .map((u: any) => ({ mktName: String(u.mkt_code).toUpperCase(), url: u.sheet_url, token: u.sheet_token }))

    if (!sources.length) {
      return res.status(400).json({ error: "Chưa có marketer nào cấu hình GG Ads Sheet URL trong Settings > Users." })
    }

    let grandSynced = 0
    const perMkt: Record<string, number> = {}
    const errors: string[] = []

    for (const src of sources) {
      try {
        const url = `${src.url}?token=${encodeURIComponent(src.token)}`
        const r = await fetch(url)
        const json: any = await r.json()

        if (!json.ok) {
          errors.push(`${src.mktName}: ${json.error ?? "unknown"}`)
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

        perMkt[src.mktName] = synced
        grandSynced += synced
      } catch (err: any) {
        errors.push(`${src.mktName}: ${err.message}`)
      }
    }

    return res.json({ ok: true, synced: grandSynced, per_mkt: perMkt, errors })
  } catch (err: any) {
    console.error("[mkt-cost-gg POST]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
