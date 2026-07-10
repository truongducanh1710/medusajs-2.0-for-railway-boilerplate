import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../lib/db"

export default async function mktChatFileCleanupJob(container: MedusaContainer) {
  const pool = getPool()
  let cleaned = 0
  let failed = 0

  try {
    const fileModule = container.resolve(Modules.FILE) as any
    const result = await pool.query(
      `SELECT id, file_key, message_id
       FROM mkt_chat_file
       WHERE expires_at < now() AND cleaned_at IS NULL
       ORDER BY expires_at ASC
       LIMIT 200`
    )

    if (result.rows.length === 0) return

    for (const row of result.rows) {
      let deleteOk = true
      try {
        await fileModule.deleteFiles([{ fileKey: row.file_key }])
      } catch (e: any) {
        deleteOk = false
        failed += 1
        console.warn(`[mkt-chat-cleanup] file delete failed for ${row.file_key}: ${e.message}`)
      }

      // Chỉ đánh dấu cleaned_at khi xóa MinIO thành công — nếu không, để lại cleaned_at = NULL
      // để lần chạy cron kế tiếp retry, tránh file rác tồn tại vĩnh viễn không bao giờ được dọn.
      if (!deleteOk) continue

      await pool.query(
        `UPDATE mkt_message
         SET file_url = NULL,
             content = CASE WHEN file_url IS NULL THEN content ELSE '[File da het han]' END,
             updated_at = now()
         WHERE id = $1`,
        [row.message_id]
      )
      await pool.query(`UPDATE mkt_chat_file SET cleaned_at = now() WHERE id = $1`, [row.id])
      cleaned += 1
    }

    console.log(`[mkt-chat-cleanup] scanned=${result.rows.length} cleaned=${cleaned} delete_failed=${failed}`)
  } catch (e: any) {
    console.error("[mkt-chat-cleanup] job failed:", e.message)
  }
}

export const config = {
  name: "mkt-chat-file-cleanup",
  schedule: "0 3 * * *",
}