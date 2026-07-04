import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { MYR_TO_VND_RATE } from "../../../../../lib/constants"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/pancake-sync/report/product-profit?from=...&to=...
 * Per-product: doanh thu, COGS, gross profit, margin, tồn kho
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to, market } = req.query as Record<string, string>
    if (!from || !to) return res.status(400).json({ error: "Thiếu from/to" })

    const mkt = market || "VN"
    const pool = getPool()

    // Doanh thu và số lượng per sản phẩm (chỉ đơn giao thành công status=3)
    const { rows: products } = await pool.query(`
      SELECT
        item->>'name' as name,
        item->'variation_info'->>'display_id' as display_id,
        SUM((item->>'quantity')::int) as qty_sold,
        SUM((item->>'price')::numeric * (item->>'quantity')::int) as revenue,
        pc.avg_cost,
        pc.stock_qty,
        pc.pancake_display_id
      FROM pancake_order po,
        jsonb_array_elements(po.raw->'items') as item
      LEFT JOIN product_cost pc
        ON pc.pancake_display_id = item->'variation_info'->>'display_id'
      WHERE po.status = 3
        AND po.pancake_created_at BETWEEN $1 AND $2
        AND po.source IN ('manual','facebook','zalo','unknown','medusa')
        AND po.market = $3
        AND po.raw->'items' IS NOT NULL
        AND (item->>'quantity') IS NOT NULL
        AND (item->>'price') IS NOT NULL
      GROUP BY name, display_id, pc.avg_cost, pc.stock_qty, pc.pancake_display_id
      ORDER BY revenue DESC
      LIMIT 50
    `, [from, to, mkt])

    // Tính COGS và profit — bảng product_cost chỉ có giá vốn VND (thị trường VN).
    // Market MY chưa có COGS riêng → không áp giá vốn VND lên doanh thu MYR (sai đơn vị tiền tệ).
    const hasCost = mkt === "VN"
    const enriched = products.map((p: any) => {
      const qty = Number(p.qty_sold ?? 0)
      const revenue = Number(p.revenue ?? 0)
      const avgCost = hasCost && p.avg_cost != null ? Number(p.avg_cost) : null
      const cogs = avgCost != null ? avgCost * qty : null
      const profit = cogs != null ? revenue - cogs : null
      const margin = revenue > 0 && profit != null ? Math.round(profit / revenue * 100) : null
      return {
        name: p.name,
        display_id: p.display_id,
        qty_sold: qty,
        revenue,
        avg_cost: avgCost,
        cogs,
        profit,
        margin,
        stock_qty: p.stock_qty != null ? Number(p.stock_qty) : null,
      }
    })

    // Tổng hợp
    const totalRevenue = enriched.reduce((s, p) => s + p.revenue, 0)
    const totalCogs    = enriched.reduce((s, p) => s + (p.cogs ?? 0), 0)
    const totalProfit  = totalRevenue - totalCogs
    const mappedCount  = enriched.filter(p => p.avg_cost != null).length
    const lowStock     = enriched.filter(p => p.stock_qty != null && p.stock_qty < 50)

    return res.json({
      market: mkt,
      ...(mkt === "MY" ? { myr_to_vnd_rate: MYR_TO_VND_RATE, cost_data_available: false } : {}),
      summary: {
        total_revenue: totalRevenue,
        total_cogs: hasCost ? totalCogs : null,
        total_profit: hasCost ? totalProfit : null,
        overall_margin: hasCost && totalRevenue > 0 ? Math.round(totalProfit / totalRevenue * 100) : null,
        mapped_count: mappedCount,
        total_products: enriched.length,
      },
      products: enriched,
      low_stock: lowStock,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
