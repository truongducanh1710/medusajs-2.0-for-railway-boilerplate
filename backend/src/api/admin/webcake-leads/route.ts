import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/webcake-leads?limit=50&offset=0&status=new
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { limit = "50", offset = "0", status } = req.query as Record<string, string>
    const lim = Math.min(Number(limit) || 50, 200)
    const off = Number(offset) || 0
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const statusFilter = status ? ` AND status = '${status}'` : ""
    const leads = await cskhService.sql(
      `SELECT * FROM webcake_lead WHERE deleted_at IS NULL${statusFilter} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`
    ).catch(() => [])

    const [countRow] = await cskhService.sql(
      `SELECT COUNT(*)::int as total FROM webcake_lead WHERE deleted_at IS NULL${statusFilter}`
    ).catch(() => [{ total: 0 }])

    return res.json({ leads, total: countRow?.total ?? 0 })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * PATCH /admin/webcake-leads — cập nhật status của lead
 * Body: { id: string, status: 'new'|'contacted'|'converted' }
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id, status } = req.body as any
    if (!id || !status) return res.status(400).json({ error: "Missing id or status" })
    const allowed = ["new", "contacted", "converted"]
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" })

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    await cskhService.sql(
      `UPDATE webcake_lead SET status = $1, updated_at = now() WHERE id = $2`,
      [status, id]
    )
    return res.json({ success: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
