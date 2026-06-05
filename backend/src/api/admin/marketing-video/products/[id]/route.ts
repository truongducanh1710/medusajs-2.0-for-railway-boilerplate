import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../_lib"

/** PATCH /admin/marketing-video/products/:id — sửa tên/mã */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const { name, code, active } = (req.body as any) ?? {}
    const pool = getPool()
    const sets: string[] = ["updated_at = now()"]
    const params: any[] = []
    if (name !== undefined) { params.push(name.trim()); sets.push(`name = $${params.length}`) }
    if (code !== undefined) { params.push(code.trim().toUpperCase()); sets.push(`code = $${params.length}`) }
    if (active !== undefined) { params.push(Boolean(active)); sets.push(`active = $${params.length}`) }
    if (sets.length === 1) return res.status(400).json({ error: "Không có field nào" })
    params.push(id)
    await pool.query(`UPDATE mkt_product SET ${sets.join(", ")} WHERE id = $${params.length}`, params)
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/** DELETE /admin/marketing-video/products/:id */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const pool = getPool()
    await pool.query(`DELETE FROM mkt_product WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
