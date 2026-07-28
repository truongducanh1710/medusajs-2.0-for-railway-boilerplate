import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../lib/db"
import { resolveUserPerms } from "../../../middlewares"

const NOTIFY_CHANNEL_ID = "__notify__"

function normalizeEmail(value: any): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

// GET /admin/mkt-tasks/assignee-notifications?assignee=<email>
// Cho manager xem lại các task_assigned đã giao cho 1 nhân sự cụ thể + trạng thái
// đã xem — khác với GET /mkt-chat/notifications (luôn là "thông báo của chính tôi").
// Không có unread_count / mark-read ở đây: đây là view chỉ-đọc cho manager, không
// nên đụng vào trạng thái "đã đọc" thực của assignee.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = (req as any).auth_context
    if (auth?.actor_type !== "user" || !auth?.actor_id) return res.status(401).json({ error: "Unauthenticated" })

    const userModule = req.scope.resolve(Modules.USER)
    const user = await userModule.retrieveUser(auth.actor_id, { select: ["email", "metadata"] })
    const isSuper = user.email === process.env.SUPER_ADMIN_EMAIL
    const perms = resolveUserPerms(user.metadata)
    const isManager = isSuper || perms.includes("page.mkt-tasks.manage")
    if (!isManager) return res.status(403).json({ error: "Chỉ manager mới xem được mục này" })

    const assignee = normalizeEmail((req.query as any)?.assignee)
    if (!assignee) return res.status(400).json({ error: "Thiếu assignee" })

    const pool = getPool()
    const readResult = await pool.query(
      `SELECT last_read_at FROM mkt_channel_read WHERE channel_id = $1 AND user_email = $2 LIMIT 1`,
      [NOTIFY_CHANNEL_ID, assignee]
    )
    const lastReadAt = readResult.rows[0]?.last_read_at || null

    const rowsResult = await pool.query(
      `SELECT id, content, created_at, deleted_at, updated_at
       FROM mkt_message
       WHERE channel_id = $1
         AND msg_type = 'system_notify'
         AND content::jsonb ->> 'type' = 'task_assigned'
         AND content::jsonb ->> 'recipient' = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [NOTIFY_CHANNEL_ID, assignee]
    )

    const notifications = rowsResult.rows.map(row => {
      try {
        const payload = JSON.parse(row.content || "{}")
        // Soft-delete (task_id read) là bằng chứng chính; fallback về last_read_at
        // cho các task_assigned tạo trước khi có tính năng mark-read theo task_id.
        const read = !!row.deleted_at || (lastReadAt ? new Date(row.created_at).getTime() <= new Date(lastReadAt).getTime() : false)
        return {
          id: row.id,
          task_id: payload.task_id,
          task_title: payload.task_title,
          sender: payload.sender,
          sender_name: payload.sender_name,
          created_at: row.created_at,
          read,
          read_at: row.deleted_at || null,
        }
      } catch {
        return null
      }
    }).filter(Boolean)

    res.json({ notifications })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
