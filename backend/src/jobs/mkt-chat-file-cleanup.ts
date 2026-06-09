import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../lib/db"

export default async function mktChatFileCleanupJob(container: MedusaContainer) {
  try {
    const fileModule = container.resolve(Modules.FILE) as any

    // Tìm tất cả file đã hết hạn
    const result = await getPool().query(
      `SELECT id, file_key, message_id FROM mkt_chat_file WHERE expires_at <= NOW()`
    )

    if (result.rows.length === 0) return

    console.log(`[mkt-chat-cleanup] Xoá ${result.rows.length} file hết hạn`)

    for (const row of result.rows) {
      try {
        // Xoá trên MinIO
        await fileModule.deleteFiles([{ fileKey: row.file_key }])

        // Xoá record
        await getPool().query(`DELETE FROM mkt_chat_file WHERE id = $1`, [row.id])

        // Cập nhật message: xoá file_url để UI không render nữa
        await getPool().query(
          `UPDATE mkt_message SET file_url = NULL, content = '[File đã hết hạn]', updated_at = NOW()
           WHERE id = $1`,
          [row.message_id]
        )
      } catch (e: any) {
        console.warn(`[mkt-chat-cleanup] Lỗi khi xoá file ${row.file_key}:`, e.message)
      }
    }
  } catch (e: any) {
    console.error("[mkt-chat-cleanup] Job lỗi:", e.message)
  }
}

export const config = {
  name: "mkt-chat-file-cleanup",
  // Chạy lúc 3:00 sáng mỗi ngày
  schedule: "0 3 * * *",
}
