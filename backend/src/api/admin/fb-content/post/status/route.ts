import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo } from "../../_lib"

/** GET /admin/fb-content/post/status?jobId= — poll tiến độ job đăng. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const jobId = (req.query as any).jobId
    if (!jobId) return res.status(400).json({ error: "Thiếu jobId" })
    const pool = getPool()
    const { rows } = await pool.query(`SELECT id, total, done, status, progress FROM fb_publish_job WHERE id = $1`, [jobId])
    if (!rows.length) return res.status(404).json({ error: "Job không tồn tại" })
    const j = rows[0]
    return res.json({ jobId: j.id, total: j.total, done: j.done, status: j.status, progress: j.progress || [] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
