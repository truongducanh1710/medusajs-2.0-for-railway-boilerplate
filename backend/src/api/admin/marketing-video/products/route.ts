import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, ensureTables } from "../_lib"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "../../../../lib/constants"

/**
 * GET /admin/marketing-video/products
 * Lấy danh sách SP từ DB (bảng mkt_product)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await ensureTables(pool)
    const { rows } = await pool.query(
      `SELECT id, name, code, pancake_id, active FROM mkt_product ORDER BY active DESC, name ASC`
    )
    return res.json({ products: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/marketing-video/products
 * Body: { action: "sync" } — pull từ Pancake về DB
 *    hoặc { name, code, pancake_id? } — thêm thủ công
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await ensureTables(pool)
    const b = (req.body as any) ?? {}

    if (b.action === "sync") {
      if (!PANCAKE_API_KEY || !PANCAKE_SHOP_ID) {
        return res.status(503).json({ error: "Chưa cấu hình PANCAKE_API_KEY" })
      }

      const fetched: { name: string; code: string; pancake_id: string }[] = []
      let page = 1
      while (true) {
        const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/products?api_key=${PANCAKE_API_KEY}&page=${page}&limit=100`
        const r = await fetch(url)
        if (!r.ok) break
        const data = await r.json()
        const items: any[] = data.data ?? data.products ?? []
        if (!items.length) break
        for (const p of items) {
          const name = (p.name || "").trim()
          const code = (p.code || p.sku || p.barcode || "").trim().toUpperCase()
          const pancake_id = String(p.id || "")
          if (name) fetched.push({ name, code, pancake_id })
        }
        if (page >= (data.total_pages ?? 1)) break
        page++
      }

      // Upsert theo pancake_id — giữ lại code đã sửa tay nếu có
      let upserted = 0
      for (const p of fetched) {
        await pool.query(`
          INSERT INTO mkt_product (name, code, pancake_id, active, updated_at)
          VALUES ($1, $2, $3, true, now())
          ON CONFLICT (pancake_id) DO UPDATE SET
            name = EXCLUDED.name,
            active = true,
            updated_at = now()
        `, [p.name, p.code, p.pancake_id])
        upserted++
      }

      // Tạo unique constraint nếu chưa có
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'mkt_product_pancake_id_key'
          ) THEN
            ALTER TABLE mkt_product ADD CONSTRAINT mkt_product_pancake_id_key UNIQUE (pancake_id);
          END IF;
        END $$
      `).catch(() => {})

      return res.json({ ok: true, synced: upserted, total: fetched.length })
    }

    // Thêm thủ công
    const { name, code = "", pancake_id = null } = b
    if (!name?.trim()) return res.status(400).json({ error: "Thiếu tên SP" })
    const { rows: [row] } = await pool.query(
      `INSERT INTO mkt_product (name, code, pancake_id, active) VALUES ($1, $2, $3, true) RETURNING *`,
      [name.trim(), code.trim().toUpperCase(), pancake_id || null]
    )
    return res.json({ product: row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
