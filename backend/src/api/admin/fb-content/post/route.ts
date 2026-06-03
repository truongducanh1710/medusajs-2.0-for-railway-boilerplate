import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, getPageTokens, filterByPerm } from "../_lib"
import { publishPost, isTokenError } from "../../../../lib/fb-graph"

const BATCH = 5

/** Validate scheduled time: FB yêu cầu 10 phút → 6 tháng tới. Trả unix hoặc null (đăng ngay). */
function parseScheduled(iso?: string): number | null {
  if (!iso) return null
  const t = Math.floor(new Date(iso).getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)
  if (t < now + 600) return null // < 10 phút → coi như đăng ngay
  if (t > now + 180 * 86400) throw new Error("Lịch đăng không được quá 6 tháng")
  return t
}

/**
 * Chạy job đăng nền: loop pages theo batch, cập nhật progress vào fb_publish_job,
 * ghi fb_scheduled_post, và set mkt_video.status='posted' nếu có video_id.
 */
async function runPublishJob(
  pool: any, jobId: string,
  pages: Array<{ page_id: string; page_name: string; access_token: string }>,
  payload: { message: string; driveUrl?: string; mediaType: "text" | "video" | "photo"; scheduledTime: number | null; videoId?: string; email: string }
) {
  const progress: any[] = []
  let done = 0

  for (let i = 0; i < pages.length; i += BATCH) {
    const slice = pages.slice(i, i + BATCH)
    await Promise.all(slice.map(async (page) => {
      let entry: any
      try {
        const { post_id } = await publishPost({
          pageId: page.page_id, pageToken: page.access_token,
          message: payload.message, driveUrl: payload.driveUrl,
          mediaType: payload.mediaType, scheduledTime: payload.scheduledTime ?? undefined,
        })
        entry = { page_id: page.page_id, page_name: page.page_name, status: "success", post_id }
        await pool.query(
          `INSERT INTO fb_scheduled_post (page_id, page_name, post_id, message, drive_url, media_type, video_id, scheduled_for, published_at, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [page.page_id, page.page_name, post_id, payload.message, payload.driveUrl ?? null, payload.mediaType,
           payload.videoId ?? null,
           payload.scheduledTime ? new Date(payload.scheduledTime * 1000) : null,
           payload.scheduledTime ? null : new Date(),
           payload.scheduledTime ? "scheduled" : "published", payload.email]
        )
      } catch (e: any) {
        const msg = isTokenError(e) ? "Token hết hạn" : (e.message || "Lỗi không xác định")
        entry = { page_id: page.page_id, page_name: page.page_name, status: "failed", error: msg }
        await pool.query(
          `INSERT INTO fb_scheduled_post (page_id, page_name, message, drive_url, media_type, video_id, status, error_msg, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,'failed',$7,$8)`,
          [page.page_id, page.page_name, payload.message, payload.driveUrl ?? null, payload.mediaType, payload.videoId ?? null, msg, payload.email]
        )
      }
      progress.push(entry); done++
      await pool.query(`UPDATE fb_publish_job SET done = $1, progress = $2 WHERE id = $3`, [done, JSON.stringify(progress), jobId])
    }))
  }

  const anyOk = progress.some(p => p.status === "success")
  const allOk = progress.every(p => p.status === "success")
  const finalStatus = allOk ? "completed" : anyOk ? "completed" : "failed"
  await pool.query(`UPDATE fb_publish_job SET status = $1, finished_at = now() WHERE id = $2`, [finalStatus, jobId])

  // Cập nhật nguồn video → posted (chỉ khi có ít nhất 1 page thành công + đăng ngay)
  if (payload.videoId && anyOk && !payload.scheduledTime) {
    await pool.query(`UPDATE mkt_video SET status = 'posted', updated_at = now() WHERE id = $1`, [payload.videoId])
  }
}

/**
 * POST /admin/fb-content/post — tạo job đăng nền, trả 202 { jobId }.
 * body: { page_ids[], message, drive_url?, media_type, scheduled_for?, video_id? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const b: Record<string, any> = (req.body && typeof req.body === "object") ? (req.body as any) : {}
    const pageIds: string[] = Array.isArray(b.page_ids) ? b.page_ids.map(String) : []
    const message: string = b.message ?? ""
    if (!pageIds.length) return res.status(400).json({ error: "Chưa chọn trang nào" })
    if (!message.trim() && (b.media_type ?? "text") === "text") return res.status(400).json({ error: "Nội dung trống" })

    let scheduledTime: number | null
    try { scheduledTime = parseScheduled(b.scheduled_for) }
    catch (e: any) { return res.status(400).json({ error: e.message }) }

    const pool = getPool()
    let allPages: any[]
    try { allPages = await getPageTokens(pool) }
    catch (e: any) {
      if (isTokenError(e)) return res.status(400).json({ error: "FB_TOKEN_EXPIRED" })
      throw e
    }

    // Lọc theo quyền + chỉ giữ page được chọn
    const allowed = filterByPerm(allPages, auth)
    const selected = allowed.filter(p => pageIds.includes(p.page_id))
    if (!selected.length) return res.status(403).json({ error: "Không có quyền đăng các trang đã chọn" })

    const { rows: [job] } = await pool.query(
      `INSERT INTO fb_publish_job (total, done, status, progress, created_by) VALUES ($1, 0, 'running', '[]', $2) RETURNING id`,
      [selected.length, auth.email]
    )

    // chạy nền — không await
    runPublishJob(pool, job.id, selected, {
      message, driveUrl: b.drive_url, mediaType: (b.media_type ?? "text"),
      scheduledTime, videoId: b.video_id, email: auth.email,
    }).catch(async (e) => {
      try { await pool.query(`UPDATE fb_publish_job SET status='failed', finished_at=now() WHERE id=$1`, [job.id]) } catch {}
      console.error("[fb-content publish job error]", e?.message)
    })

    return res.status(202).json({ jobId: job.id, total: selected.length })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
