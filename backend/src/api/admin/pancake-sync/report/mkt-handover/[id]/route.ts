import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

function getSvc(req: MedusaRequest) {
  return req.scope.resolve("cskhAnalysisModule") as any
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const svc = getSvc(req)
    await svc.sql(`UPDATE mkt_handover SET deleted_at = now() WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
