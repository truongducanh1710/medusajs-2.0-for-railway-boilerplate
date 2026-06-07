import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getChatAuthInfo, getChatPool } from "../../_lib"

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const b = (req.body as any) || {}
    const allowed = ["mode", "manual_override_instruction", "manual_override_faq", "manual_notes"]
    const sets: string[] = []
    const vals: any[] = []
    for (const f of allowed) {
      if (b[f] !== undefined) {
        vals.push(b[f])
        sets.push(`${f} = $${vals.length}`)
      }
    }
    if (!sets.length) return res.status(400).json({ error: "No fields" })
    vals.push(id)
    const pool = getChatPool()
    const { rows } = await pool.query(
      `UPDATE fb_bot_agent SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`,
      vals
    )
    return res.json({ ok: true, agent: rows[0] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
