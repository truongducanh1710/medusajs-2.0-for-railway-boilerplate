import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, ensureTables, syncMktProductsFromPancake } from "../_lib"

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
      try {
        const { synced, total } = await syncMktProductsFromPancake(pool)
        console.log(`[mkt-products sync] done: fetched=${total} upserted=${synced}`)
        return res.json({ ok: true, synced, total })
      } catch (e: any) {
        return res.status(503).json({ error: e.message })
      }
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
