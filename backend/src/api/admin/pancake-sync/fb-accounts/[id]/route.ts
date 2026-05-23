import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

function getService(req: MedusaRequest) {
  return req.scope.resolve("cskhAnalysisModule") as any
}

/**
 * PATCH /admin/pancake-sync/fb-accounts/:id
 * Cập nhật: account_name, mkt_name, active, note
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const { account_name, mkt_name, active, note } = req.body as any
    const svc = getService(req)

    const sets: string[] = ["updated_at = now()"]
    const params: any[] = []

    if (account_name !== undefined) { params.push(account_name.trim()); sets.push(`account_name = $${params.length}`) }
    if (mkt_name !== undefined) { params.push(mkt_name.trim().toUpperCase()); sets.push(`mkt_name = $${params.length}`) }
    if (active !== undefined) { params.push(Boolean(active)); sets.push(`active = $${params.length}`) }
    if (note !== undefined) { params.push(note.trim()); sets.push(`note = $${params.length}`) }

    if (sets.length === 1) return res.status(400).json({ error: "Không có field nào để cập nhật" })

    params.push(id)
    await svc.sql(
      `UPDATE fb_ad_account SET ${sets.join(", ")} WHERE id = $${params.length} AND deleted_at IS NULL`,
      params
    )

    const [row] = await svc.sql(`SELECT * FROM fb_ad_account WHERE id = $1`, [id])
    return res.json({ account: row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * DELETE /admin/pancake-sync/fb-accounts/:id
 * Xóa mềm
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const svc = getService(req)
    await svc.sql(
      `UPDATE fb_ad_account SET deleted_at = now(), active = false WHERE id = $1`,
      [id]
    )
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
