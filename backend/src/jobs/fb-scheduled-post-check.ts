import { MedusaContainer } from "@medusajs/framework"
import { Pool } from "pg"

const FB_V = "v25.0"

/**
 * Chạy mỗi 30 phút: kiểm tra bài scheduled đã qua giờ đăng.
 * - Nếu FB confirm published → cập nhật status='published', set mkt_video.status='posted'
 * - Nếu FB báo lỗi / không tìm thấy → cập nhật status='failed', ghi error_msg
 */
export default async function fbScheduledPostCheck(_container: MedusaContainer) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    // Lấy bài scheduled đã qua giờ hẹn (thêm 5 phút buffer)
    const { rows: posts } = await pool.query(`
      SELECT sp.id, sp.post_id, sp.page_id, sp.video_id, sp.scheduled_for,
             fpt.access_token
      FROM fb_scheduled_post sp
      JOIN fb_page_token fpt ON fpt.page_id = sp.page_id
      WHERE sp.status = 'scheduled'
        AND sp.post_id IS NOT NULL
        AND sp.scheduled_for <= now() - interval '5 minutes'
      LIMIT 50
    `)

    if (!posts.length) return

    console.log(`[fb-scheduled-check] Kiểm tra ${posts.length} bài đã qua giờ hẹn`)
    let published = 0, failed = 0

    for (const post of posts) {
      try {
        const url = `https://graph.facebook.com/${FB_V}/${post.post_id}?fields=id,is_published,message&access_token=${post.access_token}`
        const r = await fetch(url)
        const data = await r.json()

        if (data.error) {
          // Post không tồn tại hoặc token hết hạn
          await pool.query(
            `UPDATE fb_scheduled_post SET status='failed', error_msg=$1 WHERE id=$2`,
            [data.error.message, post.id]
          )
          failed++
          continue
        }

        if (data.is_published) {
          await pool.query(
            `UPDATE fb_scheduled_post SET status='published', published_at=now() WHERE id=$1`,
            [post.id]
          )
          // Cập nhật video → posted
          if (post.video_id) {
            await pool.query(
              `UPDATE mkt_video SET status='posted', updated_at=now() WHERE id=$1`,
              [post.video_id]
            )
          }
          published++
        }
        // is_published=false nhưng chưa qua giờ đủ lâu → bỏ qua, lần sau check lại
      } catch (e: any) {
        console.error(`[fb-scheduled-check] post ${post.post_id}:`, e.message)
      }
    }

    console.log(`[fb-scheduled-check] published=${published} failed=${failed} skipped=${posts.length - published - failed}`)
  } catch (e: any) {
    console.error("[fb-scheduled-check] error:", e.message)
  } finally {
    await pool.end()
  }
}

export const config = {
  name: "fb-scheduled-post-check",
  schedule: "*/30 * * * *", // mỗi 30 phút
}
