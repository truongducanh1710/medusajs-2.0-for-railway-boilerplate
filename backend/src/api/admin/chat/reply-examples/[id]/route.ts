import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getChatAuthInfo, getChatPool } from "../../_lib"

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const b = (req.body as any) || {}
    const status = b.review_status
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid review_status" })
    }
    const pool = getChatPool()
    const vals = [status, id]
    const approveSql = status === "approved" ? `, approved_by = $3, approved_at = now()` : ""
    if (status === "approved") vals.push(auth.email as any)
    const { rows } = await pool.query(
      `UPDATE fb_bot_reply_example SET review_status = $1 ${approveSql} WHERE id = $2 RETURNING *`,
      vals
    )
    return res.json({ ok: true, example: rows[0] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
