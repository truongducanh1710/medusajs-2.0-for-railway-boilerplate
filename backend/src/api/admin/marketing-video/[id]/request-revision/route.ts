import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool, getAuthInfo } from "../../_lib"

/**
 * POST /admin/marketing-video/:id/request-revision
 * body: { reason: string }
 *
 * Lead yêu cầu nhân sự làm lại video:
 *  1. Ghi 1 bản ghi vào mkt_video.revisions[] (ai yêu cầu, lý do, thời điểm) → lưu lịch sử sửa.
 *  2. Đổi status video → "revise" (Cần sửa) để nhìn thấy ngay trên bảng.
 *  3. Tạo 1 task loại "Nội dung" (content_post) cho chính nhân sự làm video đó, deadline +1 ngày.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const id = (req.params as any).id
    const reason = String((req.body as any)?.reason || "").trim()
    if (!reason) return res.status(400).json({ error: "Cần nhập lý do yêu cầu sửa" })

    const pool = getPool()
    const { rows } = await pool.query(
      `SELECT id, vd_code, maker, product, revisions FROM mkt_video WHERE id = $1`, [id]
    )
    if (!rows.length) return res.status(404).json({ error: "Không tìm thấy video" })
    const video = rows[0]

    // Người yêu cầu (lead)
    const actorId = (req as any).auth_context.actor_id
    const userModule = req.scope.resolve(Modules.USER)
    const requester = await userModule.retrieveUser(actorId, { select: ["first_name", "last_name", "email"] })
    const requesterName = [requester.first_name, requester.last_name].filter(Boolean).join(" ") || requester.email

    // Resolve maker (lưu dạng TÊN) → email để giao task. Không tìm được vẫn ghi revision + đổi status,
    // chỉ bỏ qua bước tạo task và báo lại cho lead biết.
    const allUsers = await userModule.listUsers({}, { select: ["email", "first_name", "last_name"] })
    const norm = (s: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ")
    const makerNorm = norm(video.maker)
    const makerUser = allUsers.find((u: any) => {
      const full = norm([u.first_name, u.last_name].filter(Boolean).join(" "))
      return full && full === makerNorm
    }) || allUsers.find((u: any) => norm(u.email) === makerNorm)
    const makerEmail = makerUser?.email || null

    const prevRevisions: any[] = Array.isArray(video.revisions) ? video.revisions : []
    const revisionNo = prevRevisions.length + 1

    // Tạo task cho nhân sự (nếu resolve được email)
    let taskId: string | null = null
    if (makerEmail) {
      try {
        const taskSvc = req.scope.resolve("mktTaskModule") as any
        const deadline = new Date()
        deadline.setDate(deadline.getDate() + 1) // +1 ngày
        const task = await taskSvc.createMktTasks({
          title: `Làm lại video ${video.vd_code}${video.product ? ` (${video.product})` : ""} — lần ${revisionNo}`,
          type: "content_post",
          assignee_id: makerEmail.toLowerCase(),
          created_by: actorId,
          deadline,
          notes: `Lý do yêu cầu sửa: ${reason}`,
          status: "todo",
          priority: "high",
          tags: ["lam_lai_video"],
          comments: [],
        })
        taskId = task?.id || null
      } catch (e: any) {
        // Không chặn — vẫn ghi revision
        console.error("[request-revision] create task error:", e.message)
      }
    }

    const revision = {
      revision_no: revisionNo,
      requested_by: requester.email,
      requested_by_name: requesterName,
      reason,
      at: new Date().toISOString(),
      task_id: taskId,
    }
    const nextRevisions = [...prevRevisions, revision]

    await pool.query(
      `UPDATE mkt_video SET revisions = $1, status = 'revise', updated_at = now() WHERE id = $2`,
      [JSON.stringify(nextRevisions), id]
    )

    return res.json({
      ok: true,
      revision,
      revisions: nextRevisions,
      task_created: !!taskId,
      maker_email_resolved: !!makerEmail,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
