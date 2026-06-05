import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

function getSvc(req: MedusaRequest) {
  return req.scope.resolve("cskhAnalysisModule") as any
}

async function ensureTable(svc: any) {
  await svc.sql(`
    CREATE TABLE IF NOT EXISTS mkt_handover (
      id          SERIAL PRIMARY KEY,
      from_code   TEXT NOT NULL,
      to_code     TEXT NOT NULL,
      effective_from DATE NOT NULL,
      note        TEXT DEFAULT '',
      created_at  TIMESTAMPTZ DEFAULT now(),
      deleted_at  TIMESTAMPTZ
    )
  `)
}

/**
 * GET /admin/pancake-sync/report/mkt-handover
 * Danh sách rule attribution bàn giao
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = getSvc(req)
    await ensureTable(svc)
    const rows = await svc.sql(
      `SELECT id, from_code, to_code, effective_from, note, created_at
       FROM mkt_handover WHERE deleted_at IS NULL ORDER BY effective_from DESC`
    )
    return res.json({ rules: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/pancake-sync/report/mkt-handover
 * Tạo rule mới: { from_code, to_code, effective_from, note? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from_code, to_code, effective_from, note = "" } = req.body as any
    if (!from_code || !to_code || !effective_from) {
      return res.status(400).json({ error: "Thiếu from_code, to_code hoặc effective_from" })
    }
    const svc = getSvc(req)
    await ensureTable(svc)
    const [row] = await svc.sql(
      `INSERT INTO mkt_handover (from_code, to_code, effective_from, note)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [from_code.toUpperCase(), to_code.toUpperCase(), effective_from, note]
    )
    return res.json({ rule: row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * DELETE /admin/pancake-sync/report/mkt-handover/:id
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const id = (req as any).params?.id ?? (req.query as any).id
    if (!id) return res.status(400).json({ error: "Thiếu id" })
    const svc = getSvc(req)
    await svc.sql(`UPDATE mkt_handover SET deleted_at = now() WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
