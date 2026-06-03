import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo } from "../../_lib"

/** PATCH /admin/fb-content/templates/:id — sửa mẫu hoặc tăng usage_count (action=use). */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const b: Record<string, any> = (req.body && typeof req.body === "object") ? (req.body as any) : {}
    const pool = getPool()

    if (b.action === "use") {
      await pool.query(`UPDATE fb_content_template SET usage_count = usage_count + 1, updated_at = now() WHERE id = $1`, [id])
      return res.json({ ok: true })
    }

    const sets: string[] = []
    const params: any[] = []
    const set = (c: string, v: any) => { params.push(v); sets.push(`${c} = $${params.length}`) }
    if (b.title !== undefined) set("title", b.title)
    if (b.message !== undefined) set("message", b.message)
    if (b.tags !== undefined) set("tags", Array.isArray(b.tags) ? b.tags : String(b.tags).split(",").map((s: string) => s.trim()).filter(Boolean))
    if (!sets.length) return res.status(400).json({ error: "Không có gì để sửa" })
    sets.push("updated_at = now()")
    params.push(id)
    await pool.query(`UPDATE fb_content_template SET ${sets.join(", ")} WHERE id = $${params.length}`, params)
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/** DELETE /admin/fb-content/templates/:id — soft delete. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const pool = getPool()
    await pool.query(`UPDATE fb_content_template SET deleted_at = now() WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
