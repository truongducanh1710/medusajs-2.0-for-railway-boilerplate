import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/gia-von/bulk-cost
 * Body: { rows: [{ product_id, product_title, avg_cost, stock_qty, total_lots }] }
 * Bulk upsert product_cost trực tiếp, không tạo import_lot.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    const body = req.body as any
    const rows: Array<{
      product_id: string
      product_title: string
      avg_cost: number
      stock_qty: number
      total_lots: number
    }> = Array.isArray(body?.rows) ? body.rows : []

    if (!rows.length) return res.status(400).json({ error: "rows is empty" })

    const now = new Date().toISOString().slice(0, 10) // varchar(10): YYYY-MM-DD
    let upserted = 0

    for (const r of rows) {
      if (!r.product_id || !r.product_title || !r.avg_cost) continue
      await cskhService.sql(
        `INSERT INTO product_cost (id, product_id, product_title, avg_cost, stock_qty, total_lots, last_imported_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (product_id) DO UPDATE SET
           product_title    = EXCLUDED.product_title,
           avg_cost         = EXCLUDED.avg_cost,
           stock_qty        = EXCLUDED.stock_qty,
           total_lots       = EXCLUDED.total_lots,
           last_imported_at = EXCLUDED.last_imported_at,
           updated_at       = now()`,
        [r.product_id, r.product_title, r.avg_cost, r.stock_qty ?? 0, r.total_lots ?? 1, now]
      )
      upserted++
    }

    return res.json({ ok: true, upserted })
  } catch (err: any) {
    console.error("[bulk-cost]", err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
