import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/mkt-tasks/cskh-products
 * Danh mục sản phẩm (tên + mã POS) từ mkt_product — dùng cho autocomplete chọn SP
 * khi bulk-tạo task gọi CSKH. Đây là bản đọc-riêng của /admin/marketing-video/products
 * để không phụ thuộc quyền page.marketing-video.view (role cskh không có quyền đó).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { rows } = await getPool().query(
      `SELECT id, name, code FROM mkt_product WHERE active = true ORDER BY name ASC`
    )
    res.json({ products: rows })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
