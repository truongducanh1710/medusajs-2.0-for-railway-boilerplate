import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
async function sql(query: string, params?: any[]): Promise<any[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(query, params ?? [])
    return result.rows
  } finally {
    client.release()
  }
}

/**
 * Phân loại nền tảng cho 1 đơn Pancake.
 * ad_platform là cột chính thức, nhưng fallback detect trực tiếp trên raw JSON phòng
 * trường hợp sync chưa kịp ghi field (đã từng xảy ra — xem Migration20260708080000).
 * Giữ đồng bộ với detectAdPlatform() trong modules/pancake-sync/service.ts và
 * storefront /api/google-orders — sửa 1 chỗ phải sửa cả 3.
 */
const PLATFORM_EXPR = `
  CASE
    WHEN ad_platform IN ('facebook', 'google') THEN ad_platform
    WHEN raw::text ILIKE '%"ads_source":"Google"%'
      OR raw::text ILIKE '%gclid=%'
      OR raw::text ILIKE '%gbraid=%'
      OR raw::text ILIKE '%wbraid=%'
      OR raw::text ILIKE '%gad_source=%'
      OR raw::text ILIKE '%gad_campaignid=%'  THEN 'google'
    WHEN fb_campaign_id IS NOT NULL           THEN 'facebook'
    WHEN COALESCE(raw->>'p_utm_source', '') ILIKE '%facebook%'
      OR COALESCE(raw->>'p_utm_source', '') ILIKE '%fb%'  THEN 'facebook'
    WHEN COALESCE(raw->>'p_utm_source', '') ILIKE '%google%' THEN 'google'
    ELSE 'other'
  END
`

/**
 * GET /admin/pancake-sync/report/mkt-platform?from=YYYY-MM-DD&to=YYYY-MM-DD&group_by=day
 *
 * Tổng COD + chi phí ads theo NỀN TẢNG (facebook / google / other).
 * - COD: pancake_order, phân loại theo ad_platform (fallback detect trên raw).
 * - Chi phí FB: mkt_ads_cost (sync từ FB Ads API).
 * - Chi phí Google: mkt_ads_cost_gg (sync từ sheet Google Ads của từng marketer).
 *
 * "other" = đơn không xác định được nguồn ads (organic/inbox/CSKH...) — có COD nhưng
 * không có chi phí, nên tách riêng để %chi phí của FB/GG không bị pha loãng.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      group_by = "day",
    } = req.query as Record<string, string>

    const truncUnit = group_by === "month" ? "month" : "day"

    // ---- Đơn hàng theo nền tảng ----
    // Bộ lọc source/tags giữ giống report/mkt để 2 tab ra cùng con số tổng.
    const orderRows = await sql(`
      SELECT
        to_char(date_trunc('${truncUnit}', pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS date,
        ${PLATFORM_EXPR} AS platform,
        COUNT(*)::int AS total_orders,
        SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END)::int AS delivered,
        SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END)::int AS new_orders,
        SUM(CASE WHEN status IN (1, 2, 4, 5, 9, 11) THEN 1 ELSE 0 END)::int AS confirmed,
        SUM(CASE WHEN status IN (6, 7, -1, -2) THEN 1 ELSE 0 END)::int AS cancelled,
        SUM(CASE WHEN status NOT IN (-2, 7) THEN GREATEST(cod_amount, total::bigint) ELSE 0 END)::bigint AS revenue_total,
        SUM(CASE WHEN status = 3 THEN GREATEST(cod_amount, total::bigint) ELSE 0 END)::bigint AS revenue_delivered,
        SUM(CASE WHEN status NOT IN (-2, 7) THEN cod_amount ELSE 0 END)::bigint AS cod_total,
        SUM(CASE WHEN status = 3 THEN cod_amount ELSE 0 END)::bigint AS cod_delivered
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
        AND NOT (tags @> '[{"name": "Đơn nháp"}]'::jsonb)
        AND NOT (tags @> '[{"name": "Đơn trùng"}]'::jsonb)
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      GROUP BY date, platform
    `, [from, to])

    // ---- Chi phí Facebook ----
    const fbRows = await sql(`
      SELECT
        to_char(date_trunc('${truncUnit}', date), 'YYYY-MM-DD') AS date,
        SUM(spend)::bigint AS cost
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
      GROUP BY date_trunc('${truncUnit}', date)
    `, [from, to])

    // ---- Chi phí Google ----
    const ggRows = await sql(`
      SELECT
        to_char(date_trunc('${truncUnit}', date), 'YYYY-MM-DD') AS date,
        SUM(cost)::bigint AS cost,
        SUM(impressions)::bigint AS impressions,
        SUM(clicks)::bigint AS clicks,
        SUM(conversions)::numeric AS conversions
      FROM mkt_ads_cost_gg
      WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
      GROUP BY date_trunc('${truncUnit}', date)
    `, [from, to])

    // ---- Gộp thành ma trận date × platform ----
    const PLATFORMS = ["facebook", "google", "other"] as const
    const emptyCell = () => ({
      total_orders: 0, delivered: 0, new_orders: 0, confirmed: 0, cancelled: 0,
      revenue_total: 0, revenue_delivered: 0, cod_total: 0, cod_delivered: 0,
      ads_cost: 0, impressions: 0, clicks: 0, conversions: 0,
    })

    const byDate: Record<string, Record<string, any>> = {}
    const touch = (date: string, platform: string) => {
      if (!byDate[date]) byDate[date] = {}
      if (!byDate[date][platform]) byDate[date][platform] = emptyCell()
      return byDate[date][platform]
    }

    for (const r of orderRows) {
      const cell = touch(r.date, r.platform)
      cell.total_orders += Number(r.total_orders)
      cell.delivered += Number(r.delivered)
      cell.new_orders += Number(r.new_orders)
      cell.confirmed += Number(r.confirmed)
      cell.cancelled += Number(r.cancelled)
      cell.revenue_total += Number(r.revenue_total)
      cell.revenue_delivered += Number(r.revenue_delivered)
      cell.cod_total += Number(r.cod_total)
      cell.cod_delivered += Number(r.cod_delivered)
    }
    for (const r of fbRows) {
      touch(r.date, "facebook").ads_cost += Number(r.cost || 0)
    }
    for (const r of ggRows) {
      const cell = touch(r.date, "google")
      cell.ads_cost += Number(r.cost || 0)
      cell.impressions += Number(r.impressions || 0)
      cell.clicks += Number(r.clicks || 0)
      cell.conversions += Number(r.conversions || 0)
    }

    const withPct = (cell: any) => ({
      ...cell,
      // %chi phí tính trên revenue_total (mọi đơn trừ hủy) — khớp cách tính care_pct ở tab MKT
      cost_pct: cell.revenue_total > 0 ? Math.round(cell.ads_cost / cell.revenue_total * 10000) / 100 : null,
      cpo: cell.total_orders > 0 ? Math.round(cell.ads_cost / cell.total_orders) : null,
      roas: cell.ads_cost > 0 ? Math.round(cell.revenue_total / cell.ads_cost * 100) / 100 : null,
    })

    const rows = Object.keys(byDate)
      .sort((a, b) => (a < b ? 1 : -1))
      .map(date => ({
        date,
        platforms: Object.fromEntries(
          PLATFORMS.filter(p => byDate[date][p]).map(p => [p, withPct(byDate[date][p])])
        ),
      }))

    // ---- Summary theo nền tảng cho cả kỳ ----
    const summary: Record<string, any> = {}
    for (const p of PLATFORMS) summary[p] = emptyCell()
    for (const date of Object.keys(byDate)) {
      for (const p of PLATFORMS) {
        const cell = byDate[date][p]
        if (!cell) continue
        for (const k of Object.keys(cell)) summary[p][k] += Number(cell[k] || 0)
      }
    }
    for (const p of PLATFORMS) summary[p] = withPct(summary[p])

    const grand = emptyCell()
    for (const p of PLATFORMS) {
      for (const k of Object.keys(grand)) grand[k] += Number(summary[p][k] || 0)
    }

    return res.json({ rows, summary, total: withPct(grand), from, to, group_by })
  } catch (err: any) {
    console.error("[report/mkt-platform]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
