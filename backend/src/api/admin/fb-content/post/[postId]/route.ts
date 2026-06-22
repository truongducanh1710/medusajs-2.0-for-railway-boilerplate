import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, getPageTokens, filterByPerm } from "../../_lib"
import { deletePost } from "../../../../../lib/fb-graph"

/** DELETE /admin/fb-content/post/:postId — xóa bài scheduled trên Facebook rồi đánh dấu local. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const id = (req.params as any).postId
    const pool = getPool()
    const { rows: [post] } = await pool.query(
      "SELECT id, page_id, post_id, video_id, status FROM fb_scheduled_post WHERE id = $1",
      [id]
    )
    if (!post) return res.status(404).json({ error: "Bài đăng không tồn tại" })
    if (post.status !== "scheduled") return res.status(400).json({ error: "Bài đăng không còn ở trạng thái lên lịch" })
    if (!post.post_id) return res.status(400).json({ error: "Bài đăng thiếu Facebook post ID" })

    const allowedPages = filterByPerm(await getPageTokens(pool), auth)
    const page = allowedPages.find((p) => p.page_id === post.page_id)
    if (!page) return res.status(403).json({ error: "Không có quyền hủy bài trên Page này" })

    await deletePost(post.post_id, page.access_token)
    await pool.query("UPDATE fb_scheduled_post SET status = 'cancelled' WHERE id = $1", [id])
    if (post.video_id) {
      await pool.query(
        `UPDATE mkt_video
            SET fb_post_links = COALESCE((
              SELECT jsonb_agg(link)
              FROM jsonb_array_elements(COALESCE(fb_post_links, '[]'::jsonb)) AS link
              WHERE COALESCE(link->>'post_url', '') NOT LIKE $1
            ), '[]'::jsonb), updated_at = now()
          WHERE id = $2`,
        ["%" + post.post_id + "%", post.video_id]
      )
    }
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
