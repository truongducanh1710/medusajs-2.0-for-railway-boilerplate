import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../../lib/db"

// GET /admin/pancake-sync/report/product-return?from=ISO&to=ISO&market=VN
// Bảng hoàn hủy tạm tính theo sản phẩm — khớp với Tình trạng Vận đơn theo Sale
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to, market = "VN" } = req.query as any
    if (!from || !to) return res.status(400).json({ error: "Missing from/to" })

    const pool = getPool()

    // Lấy các đơn trong khoảng thời gian, group by product
    // Sản phẩm = mkt_product (có name, sku)
    // Tính: tổng doanh số, số lượng hoàn, số lượng hủy, %DK hoàn hủy
    const result = await pool.query(`
      SELECT
        p.id,
        p.sku,
        p.name,
        COUNT(DISTINCT po.order_id) as total_qty,
        COUNT(DISTINCT CASE WHEN po.status = 'returned' THEN po.order_id END) as returned_qty,
        COUNT(DISTINCT CASE WHEN po.status = 'cancelled' THEN po.order_id END) as cancelled_qty,
        COALESCE(SUM(po.unit_price * po.quantity), 0) as total_revenue,
        COALESCE(
          ROUND(
            100.0 * (
              COUNT(DISTINCT CASE WHEN po.status IN ('returned', 'cancelled') THEN po.order_id END) ::NUMERIC
            ) / NULLIF(COUNT(DISTINCT po.order_id)::NUMERIC, 0),
            1
          ),
          0
        ) as expected_return_rate
      FROM mkt_product p
      LEFT JOIN pancake_order po ON po.product_id = p.id
        AND po.created_at >= $1 AND po.created_at <= $2
      GROUP BY p.id, p.sku, p.name
      HAVING COUNT(DISTINCT po.order_id) > 0
      ORDER BY total_revenue DESC
    `, [from, to])

    const rows = result.rows.map(r => ({
      product_id: r.id,
      sku: r.sku,
      name: r.name,
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
