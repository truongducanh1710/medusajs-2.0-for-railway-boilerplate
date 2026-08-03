import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../../lib/db"

// GET /admin/pancake-sync/report/product-return?from=ISO&to=ISO&market=VN
// Bảng hoàn hủy tạm tính theo sản phẩm — khớp với Tình trạng Vận đơn theo Sale
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to, market = "VN" } = req.query as any
    if (!from || !to) return res.status(400).json({ error: "Missing from/to" })

    const pool = getPool()

    // Lấy các đơn trong khoảng thời gian, group by product từ Pancake items (JSON)
    // Status Pancake: 1=pending, 2=confirmed, 3=shipped, 4=delivered, 5=returned, 6=cancelled
    const result = await pool.query(`
      WITH order_items AS (
        SELECT
          po.id as order_id,
          po.status,
          po.synced_at,
          po.total,
          jsonb_array_elements(po.items) ->> 'name' as product_name,
          (jsonb_array_elements(po.items) ->> 'qty')::INT as qty,
          (jsonb_array_elements(po.items) ->> 'price')::NUMERIC as price
        FROM pancake_order po
        WHERE po.synced_at >= $1 AND po.synced_at <= $2
          AND po.market = $3
      )
      SELECT
        product_name,
        COUNT(DISTINCT order_id) as total_qty,
        COUNT(DISTINCT CASE WHEN status = 5 THEN order_id END) as returned_qty,
        COUNT(DISTINCT CASE WHEN status = 6 THEN order_id END) as cancelled_qty,
        COALESCE(SUM(qty * price), 0) as total_revenue,
        COALESCE(
          ROUND(
            100.0 * (
              COUNT(DISTINCT CASE WHEN status IN (5, 6) THEN order_id END) ::NUMERIC
            ) / NULLIF(COUNT(DISTINCT order_id)::NUMERIC, 0),
            1
          ),
          0
        ) as expected_return_rate
      FROM order_items
      GROUP BY product_name
      HAVING COUNT(DISTINCT order_id) > 0
      ORDER BY total_revenue DESC
    `, [from, to, market])

    const rows = result.rows.map(r => ({
      name: r.product_name || "—",
      total_qty: r.total_qty,
      returned_qty: r.returned_qty,
      cancelled_qty: r.cancelled_qty,
      total_revenue: r.total_revenue,
      expected_return_rate: r.expected_return_rate,
    }))

    // Tính summary
    const summary = {
      total_qty: rows.reduce((s, r) => s + r.total_qty, 0),
      returned_qty: rows.reduce((s, r) => s + r.returned_qty, 0),
      cancelled_qty: rows.reduce((s, r) => s + r.cancelled_qty, 0),
      total_revenue: rows.reduce((s, r) => s + r.total_revenue, 0),
      expected_return_rate: rows.length > 0
        ? Math.round(rows.reduce((s, r) => s + r.expected_return_rate, 0) / rows.length * 10) / 10
        : 0,
    }

    res.json({ rows, summary, market })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
