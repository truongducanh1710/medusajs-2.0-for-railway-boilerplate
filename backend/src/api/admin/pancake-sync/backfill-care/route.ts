import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/pancake-sync/backfill-care
 * Backfill care_name + items từ raw JSON cho các đơn bị thiếu.
 * Chạy một lần sau deploy.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const mgr = (syncService as any).__container?.manager

    if (!mgr) {
      return res.status(500).json({ error: "Cannot resolve DB manager" })
    }

    const result = await mgr.execute(`
      UPDATE pancake_order
      SET
        care_name = CASE
          WHEN NULLIF(care_name, '') IS NULL AND raw->'assigning_care'->>'name' IS NOT NULL
          THEN raw->'assigning_care'->>'name'
          ELSE care_name
        END,
        items = CASE
          WHEN (items IS NULL OR items = '[]'::jsonb)
            AND raw->'items' IS NOT NULL
            AND jsonb_array_length(raw->'items') > 0
          THEN raw->'items'
          ELSE items
        END,
        items_count = CASE
          WHEN items_count = 0
            AND raw->'items' IS NOT NULL
            AND jsonb_array_length(raw->'items') > 0
          THEN jsonb_array_length(raw->'items')
          ELSE items_count
        END
      WHERE
        (NULLIF(care_name, '') IS NULL AND raw->'assigning_care'->>'name' IS NOT NULL)
        OR (
          (items IS NULL OR items = '[]'::jsonb)
          AND raw->'items' IS NOT NULL
          AND jsonb_array_length(raw->'items') > 0
        )
    `)

    return res.json({ ok: true, rowsAffected: result?.rowCount ?? "unknown" })
  } catch (err: any) {
    console.error("[backfill-care] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
