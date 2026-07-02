import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, DISPLAY_ID_ALIASES } from "../../avg-cost/route"

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

const MIN_SAMPLE_SIZE = 5

/**
 * GET /admin/gia-von/cpqc/auto-stats?code=PHVVN031_BCX&from=&to=
 *
 * Tự tính composition đơn (đơn 1 SP / đơn đảo 2 SP / đơn đất liền 3+ SP) và giá vốn
 * TB từng loại đơn, cho SP đã có lịch sử bán qua Pancake — dùng để autofill calculator CPQC.
 * Logic explode item + is_main copy từ report/product-lng (đơn ≥4 items gộp vào nhóm 3+).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      code = "",
      from = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
    } = req.query as Record<string, string>

    const codeUpper = code.trim().toUpperCase()
    if (!codeUpper) {
      return res.status(400).json({ error: "Thiếu tham số code" })
    }

    const avgCost = await computeAvgCost(getPool())

    const aliasCases = Object.entries(DISPLAY_ID_ALIASES)
      .map(([f, t]) => `WHEN '${f}' THEN '${t}'`)
      .join("\n          ")
    const resolveSql = (expr: string) => `
      CASE upper(trim(${expr}))
          ${aliasCases}
          ELSE upper(trim(${expr}))
      END`

    const tagNhap = `tags @> '[{"name":"Đơn nháp"}]'::jsonb`
    const tagTrung = `tags @> '[{"name":"Đơn trùng"}]'::jsonb`
    const nhapTrungCond = `status IN (6, -1) AND (${tagNhap} OR ${tagTrung})`
    const excludeCond = `(
      status = 7
      OR (${tagNhap} AND status IN (0, 11))
      OR (${nhapTrungCond})
    )`
    const revenueExpr = `COALESCE(NULLIF((raw->>'total_price_after_sub_discount')::numeric, 0), cod_amount::numeric, total::numeric)::bigint`
    const itemPrice = `COALESCE((mi->'variation_info'->>'retail_price')::numeric, (mi->>'price')::numeric, 0)`
    const itemValueExpr = `(${itemPrice} * COALESCE((mi->>'quantity')::numeric, 1))`

    const rows = await sql(`
      WITH oi AS (
        SELECT
          po.id AS order_id,
          po.status,
          po.tags,
          ${resolveSql("mi->'variation_info'->>'display_id'")} AS sp_code,
          upper(trim(COALESCE(mi->'variation_info'->>'name', mi->>'name', ''))) AS sp_name_up,
          COALESCE(mi->'variation_info'->>'name', mi->>'name', 'CHƯA RÕ SP') AS sp_label,
          ${itemValueExpr} AS item_value,
          ${revenueExpr} AS order_revenue,
          jsonb_array_length(COALESCE(po.raw->'items', '[]'::jsonb)) AS item_count,
          SUM(${itemValueExpr}) OVER (PARTITION BY po.id) AS order_total_value,
          MAX(${itemValueExpr}) OVER (PARTITION BY po.id) AS order_max_value
        FROM pancake_order po
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items', '[]'::jsonb)) AS mi
        WHERE po.deleted_at IS NULL
          AND po.source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
          AND po.pancake_created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.pancake_created_at < (($3::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.raw->'items' IS NOT NULL
          AND NOT ${excludeCond}
      ),
      oi2 AS (
        SELECT *, COALESCE(NULLIF(sp_code, ''), sp_name_up, 'CHƯA RÕ SP') AS sp_key,
          (item_value = order_max_value AND order_max_value > 0) AS is_main_item
        FROM oi
      ),
      -- đơn mà SP truy vấn là SP chính (item giá trị cao nhất đơn)
      main_orders AS (
        SELECT DISTINCT order_id, order_revenue, item_count
        FROM oi2
        WHERE is_main_item AND sp_key = $1
      )
      SELECT
        mo.order_id, mo.order_revenue, mo.item_count,
        oi2.sp_code, oi2.sp_label, oi2.item_value
      FROM main_orders mo
      JOIN oi2 ON oi2.order_id = mo.order_id
    `, [codeUpper, from, to])

    if (rows.length === 0) {
      return res.json({ insufficient_data: true, sample_size: 0 })
    }

    // Gom theo đơn
    const byOrder: Record<string, { revenue: number; item_count: number; items: { sp_code: string | null; sp_label: string; item_value: number }[] }> = {}
    for (const r of rows) {
      if (!byOrder[r.order_id]) {
        byOrder[r.order_id] = { revenue: Number(r.order_revenue) || 0, item_count: Number(r.item_count) || 1, items: [] }
      }
      byOrder[r.order_id].items.push({ sp_code: r.sp_code, sp_label: r.sp_label, item_value: Number(r.item_value) || 0 })
    }

    const orders = Object.values(byOrder)
    const sample_size = orders.length

    if (sample_size < MIN_SAMPLE_SIZE) {
      return res.json({ insufficient_data: true, sample_size })
    }

    const costOf = (sp_code: string | null, sp_label: string): number => {
      if (sp_code && avgCost.costs[sp_code] != null) return avgCost.costs[sp_code]
      const byName = avgCost.byName[(sp_label || "").toUpperCase()]
      return byName ?? 0
    }

    const buckets: Record<1 | 2 | 3, { count: number; costSum: number }> = {
      1: { count: 0, costSum: 0 },
      2: { count: 0, costSum: 0 },
      3: { count: 0, costSum: 0 },
    }
    const unmatchedCount: Record<string, number> = {}
    let revenueSum = 0

    for (const o of orders) {
      const bucketKey = (o.item_count <= 1 ? 1 : o.item_count === 2 ? 2 : 3) as 1 | 2 | 3
      let orderCost = 0
      for (const it of o.items) {
        const c = costOf(it.sp_code, it.sp_label)
        if (c === 0) {
          unmatchedCount[it.sp_label] = (unmatchedCount[it.sp_label] ?? 0) + 1
        }
        orderCost += c
      }
      buckets[bucketKey].count++
      buckets[bucketKey].costSum += orderCost
      revenueSum += o.revenue
    }

    const pct = (n: number) => sample_size > 0 ? n / sample_size : 0
    const avgCostOf = (b: { count: number; costSum: number }) => b.count > 0 ? Math.round(b.costSum / b.count) : 0

    // Tỷ lệ hoàn/huỷ dự kiến — copy công thức du_kien_hoan_huy từ product-lng
    // (đã filter excludeCond ở query nên tổng đơn hợp lệ = sample_size).
    const statusRows = await sql(`
      SELECT status, COUNT(*)::int AS n
      FROM pancake_order po
      WHERE po.id = ANY($1::text[])
      GROUP BY status
    `, [Object.keys(byOrder)])
    const statusCount: Record<number, number> = {}
    for (const r of statusRows) statusCount[Number(r.status)] = Number(r.n)
    const daHoan = statusCount[5] ?? 0
    const dangHoan = statusCount[4] ?? 0
    const daHuy = (statusCount[6] ?? 0) + (statusCount[-1] ?? 0)
    const daGuiHang = statusCount[2] ?? 0
    const return_rate = sample_size > 0 ? (daHoan + dangHoan + daHuy + daGuiHang / 3) / sample_size : 0

    return res.json({
      insufficient_data: false,
      sample_size,
      avg_selling_price: Math.round(revenueSum / sample_size),
      pct_don1: pct(buckets[1].count),
      pct_don2: pct(buckets[2].count),
      pct_don3: pct(buckets[3].count),
      cost_don1: avgCostOf(buckets[1]),
      cost_don2: avgCostOf(buckets[2]),
      cost_don3: avgCostOf(buckets[3]),
      return_rate: Math.round(return_rate * 1000) / 1000,
      unmatched_items: Object.entries(unmatchedCount).map(([name, count]) => ({ name, count })),
      from, to,
    })
  } catch (err: any) {
    console.error("[gia-von/cpqc/auto-stats]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
