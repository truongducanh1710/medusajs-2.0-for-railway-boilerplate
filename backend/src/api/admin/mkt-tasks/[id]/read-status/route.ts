import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

// GET /admin/mkt-tasks/:id/read-status
// Cho lead xem assignee đã thấy thông báo giao việc chưa, và lúc mấy giờ.
// "Đã đọc" ở đây nghĩa là: notify __notify__ của task này đã bị soft-delete
// (client gọi PATCH /mkt-chat/notifications/read với task_id khi mở task) —
// dùng updated_at của dòng đó làm mốc thời gian đã xem.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params as any
    if (!id) return res.status(400).json({ error: "Thiếu task id" })

    const pool = getPool()
    const result = await pool.query(
      `SELECT deleted_at, updated_at
       FROM mkt_message
       WHERE channel_id = '__notify__'
         AND msg_type = 'system_notify'
         AND content::jsonb ->> 'type' = 'task_assigned'
         AND content::jsonb ->> 'task_id' = $1
       LIMIT 1`,
      [id]
    )

    const row = result.rows[0]
    if (!row) {
      // Không có notify (vd: tự giao cho mình) → coi như không cần track đã đọc.
      return res.json({ has_notification: false, read: null, read_at: null })
    }

    const read = !!row.deleted_at
    res.json({ has_notification: true, read, read_at: read ? row.updated_at : null })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
