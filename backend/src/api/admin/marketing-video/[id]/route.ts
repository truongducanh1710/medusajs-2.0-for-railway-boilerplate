import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, STATUS_VI_TO_KEY, STATUS_KEY_TO_VI } from "../_lib"
import { getDriveFileCreatedTime } from "../../../../lib/fb-drive"

/**
 * GET /admin/marketing-video/:id
 * Dùng cho polling ai_status từ frontend.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const { rows } = await getPool().query(
      `SELECT id, ai_status, ai_score FROM mkt_video WHERE id = $1`, [id]
    )
    if (!rows.length) return res.status(404).json({ error: "Not found" })
    const r = rows[0]
    return res.json({ id: r.id, aiStatus: r.ai_status ?? null, aiScore: r.ai_score ? parseFloat(r.ai_score) : null })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * PATCH /admin/marketing-video/:id
 * Sửa dòng — đổi status (kéo Kanban), link, note, người làm, SP...
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const id = (req.params as any).id
    const b: Record<string, any> = (req.body && typeof req.body === "object") ? (req.body as any) : {}

    const sets: string[] = []
    const params: any[] = []
    const set = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`) }

    if (b.trangThai !== undefined || b.status !== undefined) {
      const vi = b.trangThai ?? STATUS_KEY_TO_VI[b.status] ?? b.status
      set("status", STATUS_VI_TO_KEY[vi] || b.status || "todo")
    }
    if (b.link !== undefined) {
      set("link", b.link)
      const driveUploadedAt = b.link ? await getDriveFileCreatedTime(b.link) : null
      if (driveUploadedAt) set("drive_uploaded_at", driveUploadedAt)
    }
    if (b.ghiChu !== undefined || b.note !== undefined) set("note", b.ghiChu ?? b.note)
    if (b.nguoiLam !== undefined || b.maker !== undefined) set("maker", b.nguoiLam ?? b.maker)
    if (b.sp !== undefined || b.product !== undefined)     set("product", b.sp ?? b.product)
    if (b.productCode !== undefined) set("product_code", b.productCode)
    if (b.loaiVideo !== undefined || b.video_type !== undefined) set("video_type", b.loaiVideo ?? b.video_type)
    if (b.nguon !== undefined || b.source !== undefined) set("source", (b.nguon === "CTV" || b.source === "ctv") ? "ctv" : "team")
    if (b.postDate !== undefined || b.post_date !== undefined) set("post_date", (b.postDate ?? b.post_date) || null)
    if (b.adName !== undefined) set("ad_name", b.adName)
    if (b.script !== undefined) set("script", b.script)
    // fb_post_links: [{page_id, page_name, post_url, posted_at}]
    if (b.fbPostLinks !== undefined) set("fb_post_links", JSON.stringify(b.fbPostLinks))
    if (b.deadline !== undefined) set("deadline", b.deadline || null)
    if (b.starred !== undefined) set("starred", !!b.starred)
    if (b.ai_score !== undefined) set("ai_score", b.ai_score)
    if (b.ai_review !== undefined) set("ai_review", JSON.stringify(b.ai_review))

    if (!sets.length) return res.status(400).json({ error: "Không có trường nào để cập nhật" })
    sets.push(`updated_at = now()`)
    params.push(id)

    const pool = getPool()
    const { rows } = await pool.query(
      `UPDATE mkt_video SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING id`,
      params
    )
    if (!rows.length) return res.status(404).json({ error: "Không tìm thấy dòng" })
    return res.json({ ok: true, id })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * DELETE /admin/marketing-video/:id
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).id
    const pool = getPool()
    await pool.query(`DELETE FROM mkt_video WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
