import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getChatAuthInfo, getChatPool } from "../_lib"

// GET /admin/chat/pages — list all pages with sync config
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const pool = getChatPool()

    // Ensure sync_enabled column exists
    await pool.query(`ALTER TABLE fb_page_token ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN DEFAULT true`)
    await pool.query(`ALTER TABLE fb_page_token ADD COLUMN IF NOT EXISTS sync_days INT DEFAULT 7`)

    const { rows } = await pool.query(
      `SELECT page_id, page_name, sync_enabled, sync_days,
              (access_token IS NOT NULL AND access_token != '') AS has_token,
              updated_at
       FROM fb_page_token
       ORDER BY page_name`
    )
    return res.json({ pages: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

// PATCH /admin/chat/pages/:page_id — update sync config
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth?.isAdmin) return res.status(403).json({ error: "Admin only" })
    const pool = getChatPool()
    const b = req.body as any
    const sets: string[] = []
    const vals: any[] = []
    if (b.sync_enabled !== undefined) { vals.push(b.sync_enabled); sets.push(`sync_enabled = $${vals.length}`) }
    if (b.sync_days !== undefined) { vals.push(b.sync_days); sets.push(`sync_days = $${vals.length}`) }
    if (!sets.length) return res.status(400).json({ error: "No fields" })
    vals.push(b.page_id)
    await pool.query(`UPDATE fb_page_token SET ${sets.join(", ")}, updated_at = now() WHERE page_id = $${vals.length}`, vals)
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
