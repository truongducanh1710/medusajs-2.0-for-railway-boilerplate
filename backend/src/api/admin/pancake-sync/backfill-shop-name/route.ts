import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"

/**
 * POST /admin/pancake-sync/backfill-shop-name
 *
 * Lấp shop_name cho đơn sàn đang để trống.
 *
 * Lúc sync chỉ đọc raw.page.name, nhưng đơn Shopee KHÔNG có page (null) — tên gian
 * hàng nằm ở raw.account_name. Hậu quả: toàn bộ đơn Shopee của các shop Vietmate
 * (Gia Dụng Vietmate, Vietmate Home Appliances...) rơi vào "(không tên)" nên không
 * nhập được chi phí ads riêng cho từng shop, làm LNG theo shop sai.
 *
 * service.ts đã sửa để fallback sang account_name; endpoint này lấp các đơn CŨ.
 * Chạy một lần sau deploy.
 *
 * GET để xem trước sẽ ảnh hưởng bao nhiêu đơn mà không ghi gì.
 */

const FILL_EXPR = `COALESCE(NULLIF(raw->'page'->>'name', ''), NULLIF(raw->>'account_name', ''))`
const WHERE_COND = `
  deleted_at IS NULL
  AND source IN ('shopee','tiktok')
  AND COALESCE(NULLIF(TRIM(shop_name), ''), '') = ''
  AND ${FILL_EXPR} IS NOT NULL
`

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const preview = await pool.query(`
      SELECT source, market, ${FILL_EXPR} AS shop, COUNT(*)::int AS orders
      FROM pancake_order
      WHERE ${WHERE_COND}
      GROUP BY 1, 2, 3
      ORDER BY 2, 1, 4 DESC
    `)
    const stillEmpty = await pool.query(`
      SELECT COUNT(*)::int AS n
      FROM pancake_order
      WHERE deleted_at IS NULL AND source IN ('shopee','tiktok')
        AND COALESCE(NULLIF(TRIM(shop_name), ''), '') = ''
        AND ${FILL_EXPR} IS NULL
    `)
    return res.json({
      will_fill: preview.rows,
      total: preview.rows.reduce((s: number, r: any) => s + Number(r.orders || 0), 0),
      // Đơn không có cả page.name lẫn account_name — backfill không giúp được,
      // phải sync lại từ Pancake nếu muốn có tên.
      still_empty_after: Number(stillEmpty.rows?.[0]?.n ?? 0),
    })
  } catch (err: any) {
    console.error("[backfill-shop-name] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const result = await pool.query(`
      UPDATE pancake_order
      SET shop_name = ${FILL_EXPR}
      WHERE ${WHERE_COND}
    `)
    return res.json({ ok: true, rowsAffected: result.rowCount ?? 0 })
  } catch (err: any) {
    console.error("[backfill-shop-name] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
