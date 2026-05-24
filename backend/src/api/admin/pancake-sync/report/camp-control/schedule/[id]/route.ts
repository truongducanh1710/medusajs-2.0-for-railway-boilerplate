import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo } from "../../_lib"

/**
 * DELETE /admin/pancake-sync/report/camp-control/schedule/:id
 * Cancel pending schedule. Owner (created_by_email) hoặc super admin mới được xoá.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const id = (req.params as any).id as string
    if (!id) return res.status(400).json({ error: "Cần id" })

    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const sqlSvc = req.scope.resolve("cskhAnalysisModule") as any
    const rows = await sqlSvc.sql(
      `SELECT created_by_email, status FROM camp_schedule WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    )
    if (!rows.length) return res.status(404).json({ error: "Schedule không tồn tại" })
    const s = rows[0]
    if (s.status !== "pending") return res.status(400).json({ error: `Không thể huỷ schedule đã ${s.status}` })
    if (!auth.isSuper && s.created_by_email !== auth.email) {
      return res.status(403).json({ error: "Chỉ người tạo schedule mới được huỷ" })
    }

    await sqlSvc.sql(
      `UPDATE camp_schedule SET status = 'cancelled', deleted_at = now() WHERE id = $1`,
      [id]
    )
    return res.json({ ok: true })
  } catch (err: any) {
    console.error("[camp-control/schedule DELETE]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
