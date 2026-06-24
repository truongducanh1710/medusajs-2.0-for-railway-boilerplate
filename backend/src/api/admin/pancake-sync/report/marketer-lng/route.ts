import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, resolveDisplayId } from "../../../gia-von/avg-cost/route"

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

const FULLFILL_PER_ORDER = 5000

/**
 * GET /admin/pancake-sync/report/marketer-lng?from=2026-06-01&to=2026-06-16
 *
 * Báo cáo Lợi nhuận gộp (LNG) tạm tính theo marketer.
 *   LNG = Doanh thu tạm tính − (Giá vốn + Vận chuyển + Ads + Fullfill)
 *   - Doanh thu tạm tính = doanh thu đơn giao thành công (status=3)
 *   - Giá vốn   = SUM(giá TB/sp từ bảng gia-von × quantity) cho đơn status=3
 *   - Vận chuyển = SUM(raw.partner_fee) cho đơn status=3
 *   - Ads       = SUM(mkt_ads_cost.spend)
 *   - Fullfill  = 5000 × tổng số đơn (trừ hủy/xóa)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
    } = req.query as Record<string, string>

    // ── Marketer attribution (copy từ report/mkt) ──────────────────────────────
    const mktExpr = `
      CASE UPPER(TRIM(COALESCE(NULLIF(TRIM(raw->'marketer'->>'name'), ''), '')))
        WHEN 'NAM DV'     THEN 'NAMDV'
        WHEN 'PHẠM DU'    THEN 'DUPD'
        WHEN 'NGUYỄN MAI' THEN 'NGUYEN MAI'
        WHEN 'TRUONGAN'   THEN 'ANHTD'
        WHEN ''           THEN NULL
        ELSE UPPER(TRIM(NULLIF(TRIM(raw->'marketer'->>'name'), '')))
      END
    `
    const mktRaw = `
      COALESCE(
        ${mktExpr},
        CASE
          WHEN raw->>'p_utm_campaign' LIKE '%\\_%\\_%'
            THEN split_part(raw->>'p_utm_campaign', '_', 2)
          WHEN raw->>'p_utm_source' LIKE '%\\_%\\_%'
            THEN split_part(raw->>'p_utm_source', '_', 2)
          ELSE 'KHÁC'
        END
      )
    `
    const mktWithFallback = `CASE WHEN ${mktRaw} = 'TRUONGAN' THEN 'ANHTD' ELSE ${mktRaw} END`

    // Handover rules
    let handoverRules: { from_code: string; to_code: string; effective_from: string; effective_to: string | null }[] = []
    try {
      handoverRules = await sql(
        `SELECT from_code, to_code, effective_from::text, effective_to::text FROM mkt_handover WHERE deleted_at IS NULL`
      )
    } catch { /* bảng chưa tồn tại */ }

    // ── Bảng giá vốn TB từ gia-von (code → giá TB) ─────────────────────────────
    const avgCost = await computeAvgCost(getPool())

    // ── Query orders + ads, group theo marketer ────────────────────────────────
    const rows = await sql(`
      SELECT
        COALESCE(o.mkt_name, c.mkt_name) AS mkt_name,
        COALESCE(o.total_orders, 0)       AS total_orders,
        COALESCE(o.revenue_total, 0)      AS revenue_total,
        COALESCE(o.revenue_delivered, 0)  AS revenue_delivered,
        COALESCE(o.ship_cost, 0)          AS ship_cost,
        o.delivered_items                 AS delivered_items,
        COALESCE(c.spend, 0)::bigint      AS ads_cost
      FROM (
        SELECT
          ${mktWithFallback} AS mkt_name,
          COUNT(*) FILTER (WHERE status NOT IN (-2, 7))::int AS total_orders,
          SUM(CASE WHEN status NOT IN (-2, 7) THEN GREATEST(cod_amount, total::bigint) ELSE 0 END)::bigint AS revenue_total,
          SUM(CASE WHEN status = 3 THEN GREATEST(cod_amount, total::bigint) ELSE 0 END)::bigint AS revenue_delivered,
          SUM(CASE WHEN status = 3 THEN COALESCE((raw->>'partner_fee')::numeric, 0) ELSE 0 END)::bigint AS ship_cost,
          jsonb_agg(raw->'items') FILTER (WHERE status = 3 AND raw->'items' IS NOT NULL) AS delivered_items
        FROM pancake_order
        WHERE deleted_at IS NULL
          AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
          AND NOT (tags @> '[{"name": "Đơn nháp"}]'::jsonb)
          AND NOT (tags @> '[{"name": "Đơn trùng"}]'::jsonb)
          AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        GROUP BY mkt_name
      ) o
      FULL OUTER JOIN (
        SELECT mkt_name, SUM(spend)::bigint AS spend
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND date >= $1::date
          AND date <= $2::date
        GROUP BY mkt_name
      ) c ON c.mkt_name = o.mkt_name
    `, [from, to])

    // ── Apply handover rules ───────────────────────────────────────────────────
    for (const row of rows) {
      for (const rule of handoverRules) {
        if (
          row.mkt_name === rule.from_code &&
          from >= rule.effective_from &&
          (!rule.effective_to || to <= rule.effective_to)
        ) {
          row.mkt_name = rule.to_code
          break
        }
      }
    }

    // ── Helper: tính COGS từ delivered_items qua bảng giá vốn ───────────────────
    function cogsFromItems(deliveredItems: any): { cogs: number; itemQty: number; mappedQty: number } {
      let cogs = 0, itemQty = 0, mappedQty = 0
      if (!Array.isArray(deliveredItems)) return { cogs, itemQty, mappedQty }
      // deliveredItems = mảng các "items array" (mỗi đơn 1 phần tử là mảng items)
      for (const itemsArr of deliveredItems) {
        if (!Array.isArray(itemsArr)) continue
        for (const it of itemsArr) {
          const qty = Number(it?.quantity ?? 0)
          if (!qty) continue
          itemQty += qty
          const vi = it?.variation_info ?? {}
          const code = resolveDisplayId(vi.display_id)
          const name = (vi.name ?? it?.name ?? "").toUpperCase()
          let unit: number | undefined
          if (code && avgCost.costs[code] != null) unit = avgCost.costs[code]
          else if (name && avgCost.byName[name] != null) unit = avgCost.byName[name]
          if (unit != null) {
            cogs += unit * qty
            mappedQty += qty
          }
        }
      }
      return { cogs, itemQty, mappedQty }
    }

    // ── Merge duplicate mkt_name (handover có thể tạo trùng) + tính field ───────
    const _debug = {
      raw_rows: rows.length,
      raw_revenue_delivered: rows.reduce((s: number, r: any) => s + Number(r.revenue_delivered ?? 0), 0),
      raw_total_orders: rows.reduce((s: number, r: any) => s + Number(r.total_orders ?? 0), 0),
      rows_detail: rows.map((r: any) => ({ mkt: r.mkt_name, rev: Number(r.revenue_delivered), orders: Number(r.total_orders) })),
    }
    const merged: Record<string, any> = {}
    for (const row of rows) {
      const m = row.mkt_name
      if (!merged[m]) {
        merged[m] = {
          mkt_name: m, total_orders: 0, revenue_total: 0, revenue_delivered: 0,
          ship_cost: 0, ads_cost: 0, cogs: 0, item_qty: 0, mapped_qty: 0,
        }
      }
      const g = merged[m]
      g.total_orders += Number(row.total_orders)
      g.revenue_total += Number(row.revenue_total)
      g.revenue_delivered += Number(row.revenue_delivered)
      g.ship_cost += Number(row.ship_cost)
      g.ads_cost += Number(row.ads_cost)
      const { cogs, itemQty, mappedQty } = cogsFromItems(row.delivered_items)
      g.cogs += cogs
      g.item_qty += itemQty
      g.mapped_qty += mappedQty
    }

    // ── Tính các field dẫn xuất ────────────────────────────────────────────────
    const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 10000) / 100 : null

    const result = Object.values(merged).map((g: any) => {
      const fullfill = FULLFILL_PER_ORDER * g.total_orders
      const cogs = Math.round(g.cogs)
      const lng = g.revenue_delivered - (cogs + g.ship_cost + g.ads_cost + fullfill)
      return {
        mkt_name: g.mkt_name,
        total_orders: g.total_orders,
        revenue_total: g.revenue_total,
        revenue_delivered: g.revenue_delivered,
        cogs,
        ship_cost: g.ship_cost,
        ads_cost: g.ads_cost,
        fullfill,
        lng,
        cogs_pct: pct(cogs, g.revenue_delivered),
        ship_pct: pct(g.ship_cost, g.revenue_delivered),
        ads_pct: pct(g.ads_cost, g.revenue_total),
        fullfill_pct: pct(fullfill, g.revenue_delivered),
        lng_pct: pct(lng, g.revenue_delivered),
        item_qty: g.item_qty,
        mapped_qty: g.mapped_qty,
      }
    }).sort((a, b) => b.lng - a.lng)

    // ── Totals ─────────────────────────────────────────────────────────────────
    const sum = (k: string) => result.reduce((s, r: any) => s + (r[k] ?? 0), 0)
    const totals = {
      total_orders: sum("total_orders"),
      revenue_total: sum("revenue_total"),
      revenue_delivered: sum("revenue_delivered"),
      cogs: sum("cogs"),
      ship_cost: sum("ship_cost"),
      ads_cost: sum("ads_cost"),
      fullfill: sum("fullfill"),
      lng: sum("lng"),
    }
    const totalItemQty = sum("item_qty")
    const totalMappedQty = sum("mapped_qty")

    return res.json({
      rows: result,
      totals,
      mapped_pct: totalItemQty > 0 ? Math.round(totalMappedQty / totalItemQty * 100) : 0,
      cost_mapped: avgCost.mapped,
      cost_total: avgCost.total,
      from, to,
      _debug,
    })
  } catch (err: any) {
    console.error("[report/marketer-lng]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
